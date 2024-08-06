const express = require('express')
const fs = require( 'fs' )
const https = require( 'https' )
const http = require( 'http' )
const { networkInterfaces } = require('os');
const { v4: uuidv4 } = require('uuid');
const { pipeline } = require('node:stream/promises');
const WebSocket = require('ws');
const openai = require( 'openai' )

const fsPromises = fs.promises;

const app = express()
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const nets = networkInterfaces();

const port = 3000
const BASE_DIR = __dirname
const WEB_DIR = `${BASE_DIR}/web`
const GRP_NAME = "test_campaign"
const NGROK_DOMAIN = "https://24ff-111-90-194-58.ngrok-free.app"
const network_info = {}
let active_calls = {}
let failed_calls = []

//system
for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
            if (!network_info[name]) {
                network_info[name] = [];
            }
            network_info[name].push(net.address);
        }
    }
}

// const sslOptions = {
//     key: fs.readFileSync( `${BASE_DIR}/server.key` ),
//     cert: fs.readFileSync( `${BASE_DIR}/server.cert` )
// };

const async_file_check = async (path) => {
    try {
        await fsPromises.access( path )
        return true
    } catch {
        return false
    }
};
//system

app.use(express.json()) // for parsing application/json

app.get( '/rooms/:groupId' , ( req , res ) => {
    const params = req.params
    res.redirect( `/rooms/${params.groupId}/${uuidv4()}` )
})

app.get( '/campaigns/:groupId' , async ( req , res ) => {
    const params = req.params
    const token = await telnyx_token( params )
    const receiver_cred = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${params.groupId}/telnyx_credentials.json` ) )
    const treat = ( dirty_sip ) => { return dirty_sip.split( "@" )[ 0 ] }
    
    if ( token.hasOwnProperty( "err" ) ) {
        console.log( token.err )
        return res.status( 404 )
    }

    res.cookie( "telnyx_receiver" , treat( receiver_cred.data.sip_username ) , { expires : 0 } )
    res.cookie( "telnyx_token" , token , { expires : 0 } )
    res.cookie( "ngrok_url" , `${NGROK_DOMAIN.split( "/" )[ 2 ]}` , { expires : 0 } )
    return res.sendFile( WEB_DIR + '/chat_rx.html' )
})

app.get( '/rooms/:groupId/:roomId' , async ( req , res ) => {
    const params = req.params
    const token = await telnyx_token(  params )
    const receiver_cred = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${params.groupId}/telnyx_credentials.json` ) )
    const self_cred = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${params.groupId}/tx/${params.roomId}/telnyx_credentials.json` ) )
    const treat = ( dirty_sip ) => { return dirty_sip.split( "@" )[ 0 ] }

    if ( token.hasOwnProperty( "err" ) ) { 
        console.log( token.err )
        return res.status( 404 )
    }

    res.cookie( "telnyx_sip" , treat( self_cred.data.sip_username ) , { expires : 0 } )
    res.cookie( "telnyx_receiver" , treat( receiver_cred.data.sip_username ) , { expires : 0 } )
    res.cookie( "telnyx_token" , token , {expires : 0} )
    res.cookie( "ngrok_url" , `${NGROK_DOMAIN.split( "/" )[ 2 ]}` , { expires : 0 } )
    return res.sendFile( WEB_DIR + '/chat_tx.html' )
})

app.post( "/telnyx/events" , async ( req , res ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const treat = ( dirty_sip ) => { return dirty_sip.split( "@" )[ 0 ] }
    const data = req.body.data
    const meta = req.body.meta
    const b64buffer = Buffer.from( data.payload.client_state , "base64" )
    const json_client_state = JSON.parse( b64buffer.toString( "utf-8" ) )
    const caller_fpath = `${WEB_DIR}/data/${json_client_state.groupId}/tx/${json_client_state.roomId}/telnyx_credentials.json`
    const receiver_fpath = `${WEB_DIR}/data/${json_client_state.groupId}/telnyx_credentials.json`
    const caller_cred = JSON.parse( await fsPromises.readFile( caller_fpath ) )
    const receiver_cred = JSON.parse( await fsPromises.readFile( receiver_fpath ) )
    let payload = data.payload
    let fetch_opts = {}
    let action = ""

    payload.from = ( payload.from == undefined ) ?  treat( caller_cred.data.sip_username ) : treat( payload.from )
    payload.to = ( payload.to == undefined ) ? treat( receiver_cred.data.sip_username ) : treat( payload.to )

    if ( failed_calls.includes( payload.from ) ) { return 0 }
    if ( meta.attempt != 1 ) { return 0 }

    const ret_data = {
        call_control_id : payload.call_control_id ,
        client_state : json_client_state ,
        from : payload.from ,
        to : payload.to
    }

    if ( data.event_type == "call.initiated" ) {
        fetch_opts.body = JSON.stringify()
        fetch_opts.url = `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`
        action = "answer"
    }

    if ( data.event_type == "call.answered" ) {
        const greeting_key = "Greeting"
        const transcript = await fsPromises.readFile( `${WEB_DIR}/data/${json_client_state.groupId}/${greeting_key}.txt` )
        const transcript_file = `${WEB_DIR}/data/${json_client_state.groupId}/tx/${json_client_state.roomId}/transcript.json`
        fetch_opts.body = JSON.stringify( {
            audio_url: `${NGROK_DOMAIN}/data/${json_client_state.groupId}/${greeting_key}.webm`,
            loop: 1 ,
            client_state: payload.client_state ,
        })
        fetch_opts.url = `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/playback_start`
        action = "playback_answer"
        broadcast( JSON.stringify( { rx : payload.to , data : transcript.toString() , msg_name : "ai_chat" } ) )
        fsPromises.writeFile( transcript_file , JSON.stringify( { data : [ `${transcript.toString()}` ] } ) , null , "\t" )
    }

    if ( data.event_type == "call.playback.started" ) {
        broadcast( JSON.stringify( { rx : payload.to , data : ret_data , msg_name : "ai_turn" } ) )
    }

    if ( data.event_type == "call.playback.ended" ) {
        broadcast( JSON.stringify( { rx : payload.from , data : ret_data , msg_name : "start_vad" } ) )
    }

    if ( data.event_type == "call.hangup" ) {
        delete active_calls[ payload.from ]
        broadcast( JSON.stringify( { rx : payload.to , data : ret_data , msg_name : "call_hangup" } ) )
    }

    if ( ! fetch_opts.url ) { return 0 }

    fetch_telnyx( fetch_opts )
        .then( async (json) => {
            if ( json.errors ) {
                console.log( fetch_opts )
                console.log( json )

                if ( action == "answer" ) { failed_calls.push( payload.from ) }

                broadcast( JSON.stringify ( { rx : payload.to , data : json.errors , msg_name : "call_error" } ) )
            } else {
                if ( action == "answer" ) {
                    // active_calls[ payload.from ].state = ret_data
                    const proj = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${json_client_state.groupId}/config.json` ) )
                    const choice = Math.floor( Math.random() * proj.ELEVENLABS_VOICES.length ) - 1
                    active_calls[ payload.from ] = {
                        question_cnt : 0 ,
                        assistant_id : null ,
                        thread_id : null ,
                        elevenlabs_vid : proj.ELEVENLABS_VOICES[ ( choice < 0 ) ? 0 : choice ] ,
                    }
                    broadcast( JSON.stringify( { rx : payload.to , data : ret_data , msg_name : "call_answered" } ) )
                }
            }
        })
})

app.get( "/trigger_custom" , ( req , res ) => {
    wss.emit( "broadcast" , "" )
})

app.get( '/js/*' , ( req , res ) => {
    res.sendFile( WEB_DIR + req.path )
})

app.get( '/css/*' , ( req , res ) => {
    res.sendFile( WEB_DIR + req.path )
})

app.get( '/data/*' , (req , res) => {
    res.sendFile( WEB_DIR + req.path )
})

app.get( '/*' , (req , res) => {
    res.sendFile( WEB_DIR + '/index.html' )
})

wss.on( 'connection' , ( ws ) => {

    console.log( "user connected" )

    ws.on( 'message' , async ( e ) => {

        const json = JSON.parse( e.toString( "utf-8" ) )
        let client_state = null

        if ( json.data.hasOwnProperty( "client_state" ) ) { client_state = json.data.client_state }

        if ( json.msg_name == "" ) { return console.log( "msg_name is needed" ) }

        // if ( active_calls.hasOwnProperty( json.data.from ) ) { return console.log( "call is no longer available" ) }

        if ( json.msg_name == "recording_end" ) {

            const audioBuffer = Buffer.from(json.audiob64, "base64");
            const qcnt = active_calls[ json.data.from ].question_cnt
            const audio_path = `${WEB_DIR}/data/${client_state.groupId}/tx/${client_state.roomId}/answer_${qcnt}.wav`

            fs.writeFile( audio_path , audioBuffer , ( err ) => {
                if ( err ) { return console.log( err ) }

                fetch_openai_transcript(audio_path)
                    .then( async ( transcript ) => {
                        const instruct_file = `${WEB_DIR}/data/${client_state.groupId}/Instructions.txt`
                        const instruct_curr = Buffer.from( await fsPromises.readFile( instruct_file ) ).toString()
                        const transcript_file = `${WEB_DIR}/data/${client_state.groupId}/tx/${client_state.roomId}/transcript.json`
                        const transcript_json = JSON.parse( await fsPromises.readFile( transcript_file ) )
                        const code_regexp = new RegExp( "^<\\*CD_" )
                        const gpt_model = "gpt-4o"
                        let assistant_reply = ""

                        transcript_json.data.push( `${transcript.text}` )
                        broadcast( JSON.stringify( { rx : json.data.to , data : transcript.text , msg_name : "human_chat" } ) )

                        if ( active_calls[ json.data.from ].assistant_id == null ) {
                            const assistant_opts = {
                                model : gpt_model ,
                                name : `${client_state.groupId}_${client_state.roomId.split( "-" )[ 0 ]}` ,
                                instructions : instruct_curr ,
                                ids : client_state ,
                                action : "create_assistant"
                            }
                            active_calls[ json.data.from ].assistant_id = await fetch_openai_assistant( assistant_opts )
                        }

                        if ( active_calls[ json.data.from ].thread_id == null ) {
                            let messages = []
                            for (var i = 0; i < transcript_json.data.length; i++) {
                                messages.push( { role : ( i % 2 == 0 ) ? "assistant" : "user" , content : transcript_json.data[ i ] } )
                            }
                            let assistant_opts = {
                                assistant_id : active_calls[ json.data.from ].assistant_id ,
                                thread_msgs : messages , 
                                ids : client_state ,
                                action : "create_and_run"
                            }
                            try {
                                const res = await fetch_openai_assistant( assistant_opts )
                                active_calls[ json.data.from ].thread_id = res.thread_id
                                assistant_reply = res.reply
                            } catch  {
                                assistant_reply = null
                            }

                        } else {
                            let assistant_opts = {
                                thread_id : active_calls[ json.data.from ].thread_id ,
                                message : { role : "user" , content : transcript_json.data[ transcript_json.data.length - 1 ] } ,
                                ids : client_state ,
                                action : "create_message"
                            }
                            await fetch_openai_assistant( assistant_opts )

                            assistant_opts = {
                                thread_id : active_calls[ json.data.from ].thread_id ,
                                assistant_id : active_calls[ json.data.from ].assistant_id ,
                                ids : client_state ,
                                action : "create_run"
                            }
                            try {
                                assistant_reply = await fetch_openai_assistant( assistant_opts )
                            } catch {
                                assistant_reply = null
                            }
                        }

                        if ( assistant_reply == null ) {
                            console.log( "ask for assistance" )
                            return
                        }

                        active_calls[ json.data.from ].question_cnt += 1
                        transcript_json.data.push( `${assistant_reply}` )
                        fsPromises.writeFile( transcript_file , JSON.stringify( transcript_json ) , null , "\t" )
                        broadcast( JSON.stringify( { rx : json.data.to , data : assistant_reply , msg_name : "ai_chat" } ) )

                        const elevenlabs_opts = {
                            voice_id : active_calls[ json.data.from ].elevenlabs_vid ,
                            body : JSON.stringify({
                                text : assistant_reply ,
                                model : "eleven_monolingual_v2"
                            }) ,
                            outpath : `${WEB_DIR}/data/${client_state.groupId}/tx/${client_state.roomId}/ai_answer.mp3`
                        }

                        await fetch_elevenlabs( elevenlabs_opts )

                        const telnyx_opts = {
                            body : JSON.stringify({
                                audio_url: `${NGROK_DOMAIN}/data/${client_state.groupId}/tx/${client_state.roomId}/ai_answer.mp3`,
                                loop: 1 ,
                                stop : "current" ,
                                client_state: Buffer.from( JSON.stringify( client_state ) ).toString( "base64" )   ,
                            }) ,
                            url : `https://api.telnyx.com/v2/calls/${json.data.call_control_id}/actions/playback_start`
                        }

                        fetch_telnyx( telnyx_opts )

                        if ( code_regexp.test( assistant_reply ) ) { console.log( `Guard Rail ${assistant_reply} triggered` ) }

                        // if ( code_regexp.test( assistant_reply ) ) {
                        //     console.log( `Guard Rail ${assistant_reply} Triggered` )
                        // } else {

                        // }

                    })
            })

        } else if ( json.msg_name == "human_turn" ) {
            broadcast( JSON.stringify( { rx : json.data.to , data : json.data , msg_name : "human_turn" } ) )
        } else if ( json.msg_name == "assisatance" ) {
            broadcast( JSON.stringify( { rx : json.data.to , data : json.data , msg_name : "assistance" } ) )
        }

    })

})

const broadcast = ( data ) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

const fetch_telnyx = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    let fetch_opts = {
        method : "POST" ,
        headers : {
            "Content-Type" : "Application/Json" ,
            "Authorization" : `Bearer ${obj.TELNYX_API_KEY}`
        } ,
        body : opts.body
    }
    let res = await fetch( opts.url , fetch_opts )

    if ( opts.rettype == "str" ) { return res.text() }

    return res.json()
}

const fetch_openai_transcript = async( audio_path ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const openai_client = new openai({ apiKey : obj.OPENAI_API_KEY })

    let transcription = await openai_client.audio.transcriptions.create({
        file : fs.createReadStream( audio_path ) ,
        model : "whisper-1"
    })

    return transcription
}

const fetch_openai_assistant = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const proj = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${opts.ids.groupId}/config.json` ) )
    const openai_client = new openai({ 
        apiKey : obj.OPENAI_API_KEY ,
        project : proj.OPENAI_PROJECT
    })

    if ( opts.action == "create_assistant" ) {
        const myAssistant = await openai_client.beta.assistants.create({
            instructions: opts.instructions ,
            name: opts.name,
            model: opts.model,
        })
        return myAssistant.id
    } else if ( opts.action == "create_and_run" ) {
        let assistant_reply = ""
        const stream = await openai_client.beta.threads.createAndRun({
            assistant_id: opts.assistant_id,
            thread: {
                messages: opts.thread_msgs
            },
            stream: true
        })

        for await (const event of stream) {
            console.log( event )
            if ( event.event == "thread.message.completed" ) { assistant_reply = event.data.content[ 0 ].text.value }
            if ( event.event == "thread.run.completed" ) { return { thread_id : event.data.thread_id , reply : assistant_reply } }
        }
    } else if ( opts.action == "create_message" ) {
        const threadMessages = await openai_client.beta.threads.messages.create( opts.thread_id, opts.message )
    } else if ( opts.action == "create_run" ) {
        let assistant_reply = ""
        const stream = await openai_client.beta.threads.runs.create( opts.thread_id, { assistant_id: opts.assistant_id, stream: true } );
        for await ( const event of stream ) {
            if ( event.event == "thread.message.completed" ) { assistant_reply = event.data.content[ 0 ].text.value }
            if ( event.event == "thread.run.completed" ) { return assistant_reply }
        }
    }
}

const fetch_elevenlabs = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const CHUNK_SIZE = 1024
    const fetch_opts = {
        method : "POST" ,
        headers : {
            "Accept" : "audio/mpeg" ,
            "Content-Type" : "application/json" ,
            "xi-api-key" : obj.ELEVENLABS_API_KEY
        } ,
        body : opts.body
    }
    const res = await fetch( `https://api.elevenlabs.io/v1/text-to-speech/${opts.voice_id}` , fetch_opts )

    await pipeline(
        res.body ,
        fs.createWriteStream( opts.outpath )
    )
}

const telnyx_token = async( params ) => {
    let fpath = WEB_DIR
    fpath += ( params.roomId ) ? `/data/${params.groupId}/tx/${params.roomId}` : `/data/${params.groupId}/`

    if ( ! await async_file_check( fpath ) ) { await fsPromises.mkdir( fpath , { recursive : true } ) }

    if ( ! await async_file_check( `${BASE_DIR}/keys.json` ) ) { console.log( "WHERE THE KEYS AT" ); process.exit( 1 ) }

    if ( ! await async_file_check( `${fpath}/telnyx_credentials.json` ) ) {
        const proj = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${params.groupId}/config.json` ) )
        let fetch_opts = {
            body : JSON.stringify( { connection_id : `${ (params.roomId) ? proj.SIP_PAIR.tx : proj.SIP_PAIR.rx }` } ) ,
            url : "https://api.telnyx.com/v2/telephony_credentials"
        }
        await fsPromises.writeFile( `${fpath}/telnyx_credentials.json` , JSON.stringify( ( await fetch_telnyx( fetch_opts ) ) , null , "\t" ) )
    }
    let telnyx_cred = JSON.parse( await fsPromises.readFile( `${fpath}/telnyx_credentials.json` ) )

    if ( ! await async_file_check( `${fpath}/telnyx_token.txt` ) ) {
        let fetch_opts = {
            body : JSON.stringify( {} ) ,
            url : `https://api.telnyx.com/v2/telephony_credentials/${telnyx_cred.data.id}/token` ,
            rettype : "str"
        }
        await fsPromises.writeFile( `${fpath}/telnyx_token.txt` , await fetch_telnyx( fetch_opts ) )
    } else {
        const filestat = await fsPromises.lstat( `${fpath}/telnyx_token.txt` )
        const expired = ( Math.floor(+new Date() / 1000) - Math.floor( filestat.birthtimeMs / 1000 ) >= 86200 ) ? true : false
        if ( expired ) { return { "err" : `${fpath} telnyx_token is expired` } }
    }
    let str_token = await fsPromises.readFile( `${fpath}/telnyx_token.txt` )
    return str_token.toString()
}

const main = async () => {

    server.listen( port, "0.0.0.0" , () => {
        console.log( `Listing on the ff
          ` )
        for( interface in network_info ) {
          console.log( `${network_info[ interface ][ 0 ]}:${port}` )
        }
        console.log( `
        command to state : node index
        command to stop : Ctrl + C` )
    })

    // https.createServer(sslOptions, app).listen(port, "0.0.0.0", () => {
    //     console.log(`HTTPS Server listening on the following interfaces:`);
    //     for (const interfaceName in network_info) {
    //         console.log(`${network_info[interfaceName][0]}:${port}`);
    //     }
    //     console.log(`
    //     Command to start: node index
    //     Command to stop: Ctrl + C`);
    // });
}

main()
