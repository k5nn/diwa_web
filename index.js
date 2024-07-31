const express = require('express')
const fs = require( 'fs' )
const https = require( 'https' )
const http = require( 'http' )
const { networkInterfaces } = require('os');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const fsPromises = fs.promises;

const app = express()
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const nets = networkInterfaces();

const port = 3000
const BASE_DIR = __dirname
const WEB_DIR = `${BASE_DIR}/web`
const GRP_NAME = "test_campaign"
const NGROK_DOMAIN = "https://c0b3-124-104-1-173.ngrok-free.app"
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

const sslOptions = {
    key: fs.readFileSync( `${BASE_DIR}/server.key` ),
    cert: fs.readFileSync( `${BASE_DIR}/server.cert` )
};

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
    const caller_fpath = `${WEB_DIR}/data/${json_client_state.groupId}/tx/${json_client_state.roomId}/telnyx_credentials.json`
    const receiver_fpath = `${WEB_DIR}/data/${json_client_state.groupId}/telnyx_credentials.json`
    let payload = data.payload
    let b64buffer = Buffer.from( payload.client_state , "base64" )
    let json_client_state = JSON.parse( b64buffer.toString( "utf-8" ) )
    let fetch_opts = {}
    let action = ""
    let caller_cred = JSON.parse( await fsPromises.readFile( caller_fpath ) )
    let receiver_cred = JSON.parse( await fsPromises.readFile( receiver_fpath ) )

    payload.from = ( payload.from == undefined ) ?  treat( caller_cred.data.sip_username ) : treat( payload.from )
    payload.to = ( payload.to == undefined ) ? treat( receiver_cred.data.sip_username ) : treat( payload.to )

    if ( failed_calls.includes( payload.from ) ) { return 0 }
    if ( meta.attempt != 1 ) { return 0 }

    const ret_data = {
        call_control_id : payload.call_control_id ,
        client_state : json_client_state ,
        from : payload.from ,
        to : payload.to ,
        elevenlabs_voice : null ,
        assistant_id : null ,
        assistant_thread : null
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
        fsPromises.writeFile( transcript_file , JSON.stringify( { data : [ transcript.toString() ] } ) , null , "\t" )
    }

    if ( data.event_type == "call.playback.started" ) {
        if ( active_calls.hasOwnProperty( payload.from ) ) { active_calls[ payload.from ].state = payload }
        broadcast( JSON.stringify( { rx : payload.to , data : ret_data , msg_name : "ai_turn" } ) )
    }

    if ( data.event_type == "call.playback.ended" ) {
        if ( active_calls.hasOwnProperty( payload.from ) ) { active_calls[ payload.from ].state = payload }
        broadcast( JSON.stringify( { rx : payload.from , data : ret_data , msg_name : "start_vad" } ) )
    }

    if ( data.event_type == "call.hangup" ) {
        delete active_calls[ payload.from ]
        broadcast( JSON.stringify( { rx : payload.to , data : ret_data , msg_name : "call_hangup" } ) )
    }

    if ( ! fetch_opts.url ) { return 0 }

    fetch_telnyx( fetch_opts )
        .then( (json) => {
            if ( json.errors ) {
                console.log( fetch_opts )
                console.log( json )

                if ( action == "answer" ) { failed_calls.push( payload.from ) }

                broadcast( JSON.stringify ( { rx : payload.to , data : json.errors , msg_name : "call_error" } ) )
            } else {
                if ( action == "answer" ) {
                    active_calls[ payload.from ] = ret_data
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

        if ( json.data.hasOwnProperty( "client_state" ) ) {
            client_state = json.data.client_state
        }
        
        console.log( json )

        if ( json.msg_name == "" ) { return console.log( "msg_name is needed" ) }

        if ( json.msg_name == "recording_end" ) {

            const transcript_file = `${WEB_DIR}/data/${client_state.groupId}/tx/${client_state.roomId}/transcript.json`
            const transcript_curr = JSON.parse( await fsPromises.readFile( transcript_file ) )
            const audioBuffer = Buffer.from(json.audiob64, "base64");
            const audio_path = `${WEB_DIR}/data/${client_state.groupId}/tx/${client_state.roomId}/answer_${transcript_curr.data.length}.wav`

            fs.writeFile( audio_path , audioBuffer , ( err ) => {
                if ( err ) { return console.log( err ) }

                // fetch_openai_transcript({ input_file : audio_path })
                //     .then( async ( json ) => {
                //         const instruct_file = `${WEB_DIR}/data/${client_state.groupId}/Instructions.txt`
                //         let instruct_curr = await fs.Promises.readFile( instruct_file )
                //         let assistant_opts = {
                //             ids : client_state
                //         }

                //         transcript_curr.push( json.text )
                //         fsPromises.writeFile( transcript_file , JSON.stringify( transcript_curr ) , null , "\t" )

                //         broadcast( JSON.stringify( { rx : json.data.to , data : json.text , msg_name : "human_chat" } ) )

                //         if ( json.assistant_id == null ) {

                //             assistant_opts.body = JSON.stringify({
                //                 model : "gpt-4o" ,
                //                 name : "campaign assistant" ,
                //                 instructions : instruct_curr ,
                //             })

                //             // fetch_openai_assistant( assistant_opts )
                //         }

                //     })
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

const fetch_openai_transcript = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    let fetch_opts = {
        method : "POST" ,
        headers : {
            "Content-Type" : "multipart/form-data" ,
            "Authorization" : `Bearer ${obj.ELEVENLABS_API_KEY}`
        } ,
        body : JSON.stringify({
            file : opts.input_file ,
            model : "whisper-1"
        })
    }
    let res = await fetch( "https://api.openai.com/v1/audio/transcriptions" , fetch_opts )

    return res.json()
}

const fetch_openai_assistant = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const proj = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${opts.ids.groupId}/config.json` ) )
    let fetch_opts = {
        method : "POST" ,
        headers : {
            "Content-Type" : "application/json" ,
            "Authorization" : `Bearer ${obj.OPENAI_API_KEY}` ,
            "OpenAI-Beta" : "assistants=v2" ,
            "OpenAI-Project" : proj.OPENAI_PROJECT
        } ,
        body : opts.body
    }
    let res = await fetch( opts.url , fetch_opts )

    return res.json()

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
