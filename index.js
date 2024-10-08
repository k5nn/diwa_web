const express = require('express')
const fs = require( 'fs' )
const http = require( 'http' )
const https = require( 'https' )
const { networkInterfaces } = require('os');
const { v4: uuidv4 } = require('uuid');
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
// const WEB_DOMAIN = "https://app.diwa.ai"
const WEB_DOMAIN = "https://localhost"
const network_info = {}

let active_calls = {}
let keys = {}

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
    const uuid_gen = uuidv4()

    fs.mkdir( `${WEB_DIR}/data/${params.groupId}/tx/${uuid_gen}`, { recursive : true } , ( err , data ) => {
        if ( err ) { 
            console.error( `[MKDIR] ${WEB_DIR}/data/${params.groupId}/tx/${uuid_gen} failed` ); 
            return res.redirect( req.originalUrl ) 
        }

        fs.readFile( `${WEB_DIR}/data/${params.groupId}/config.json` , ( err , data ) => {
            if ( err ) {
                console.error( `[R CONFIG] ${params.groupId} config.json` );
                return res.status( 500 )
            }

            fs.readFile( `${WEB_DIR}/data/${params.groupId}/Instructions.txt` , ( err , data ) => {
                if ( err ) {
                    console.error( `[R INSTRUCTIONS] ${params.groupId} Instructions.txt` );
                    return res.status( 500 )
                }

                return res.redirect( `/rooms/${params.groupId}/${uuid_gen}` )
            })
        })
    })
})

app.get( '/campaigns/:groupId' , async ( req , res ) => {
    const params = req.params
    res.cookie( "web_url" , `${WEB_DOMAIN.split( "/" )[ 2 ]}` , { expires : 0 } )

    fs.writeFile( `${WEB_DIR}/data/${params.groupId}/offers_candidates.json` , JSON.stringify( { c : [] } ) , ( err ) => {
        if ( err ) { console.error( `[W ]` ) }
    })

    return res.sendFile( WEB_DIR + '/chat_rx.html' )
})

app.get( "/rooms/:groupId/:roomId" , ( req , res ) => {
    const params = req.params
    const current_epoch = new Date

    fs.readdir( `${WEB_DIR}/data/${params.groupId}/tx/${params.roomId}` , async ( err , files ) => {

        if ( err ) { console.error( `[R ${params.groupId}/${params.roomId}] Read Failed` ); return res.status( 500 ) }

        if ( !files.includes( "expiry.txt" ) ) {
            const expiry_epoch = new Date( current_epoch.getTime() + 6 * 60 * 60 * 1000 )
            await fs.writeFile(
                `${WEB_DIR}/data/${params.groupId}/tx/${params.roomId}/expiry.txt` , 
                JSON.stringify( { "expiry_timestamp" : expiry_epoch.getTime() } ) , 
                ( err ) => {
                    if ( err ) { console.error( `[W EXPIRY] ${params.roomId} creation failed` ); return res.status( 500 ) }
            })
        }

        res.cookie( "web_url" , `${WEB_DOMAIN.split( "/" )[ 2 ]}` , { expires : 0 } )
        res.cookie( "audio_path" , `/data/${params.groupId}/Greeting.mp3` , { expires : 0 } )

        if ( active_calls.hasOwnProperty( params.roomId ) ) { return res.sendFile( `${WEB_DIR}/chat_tx.html` ) }

        fs.readFile( `${WEB_DIR}/data/${params.groupId}/Greeting.txt` , ( err , data ) => {

            if ( err ) { console.error( `[R Greeting.txt] Greeting.txt Failed` ); return res.status( 500 ) }

            const init_transcript = { transcript : [ data.toString( "utf-8" ) ] }

            fs.writeFile( 
                `${WEB_DIR}/data/${params.groupId}/tx/${params.roomId}/transcript.json` , 
                JSON.stringify( init_transcript ) , 
                ( err ) => {
                    if ( err ) { console.error( `[W transcript.json] ${params.groupId}/${params.roomId}` ); return res.status( 500 ) }
            })
        })

        fs.readFile( `${WEB_DIR}/data/${params.groupId}/tx/${params.roomId}/expiry.txt` , ( err , data ) => {

            if ( err ) { 
                console.error( `[R Expiry] ${params.groupId}/${params.roomId} token Unreadable` ); 
                return res.status( 500 ) 
            }

            if ( current_epoch.getTime() > JSON.parse( data ).expiry_timestamp ) {
                console.error( `${params.groupId}/${params.roomId} token expired` ); 
                return res.status( 500 )
            }

            fs.readFile( `${WEB_DIR}/data/${params.groupId}/Instructions.txt` , ( err , instruct_data ) => {

                if ( err ) { console.error( `[R Instructions] ${params.groupId} Instructions Unreadable` ); return res.status( 500 ) }

                fs.readFile( `${WEB_DIR}/data/${params.groupId}/config.json` , async ( err , data ) => {

                    if ( err ) { console.error( `[R Config] ${params.groupId} config Unreadable` ); return res.status( 500 ) }

                    const grp_cfg = JSON.parse( data )
                    const voice_choice = Math.floor( Math.random() * grp_cfg.ELEVENLABS_VOICES.length ) - 1
                    const assistant_opts = {
                        model : "gpt-4o" ,
                        name : `${params.groupId}_${params.roomId.split( "-" )[ 0 ]}` ,
                        instructions : instruct_data.toString( "utf-8" ) ,
                        group : params.groupId ,
                        action : "create_assistant"
                    }

                    active_calls[ params.roomId ] = {
                        question_cnt : 0 ,
                        assistant_id : await fetch_openai_assistant( assistant_opts ) ,
                        thread_id : null ,
                        elevenlabs_vid : grp_cfg.ELEVENLABS_VOICES[ ( voice_choice < 0 ) ? 0 : voice_choice ]
                    }

                    return res.sendFile( `${WEB_DIR}/chat_tx.html` )
                })
            })
        })
    })
})

app.post( "/end_session" , ( req , res ) => {
    const json = req.body
    delete active_calls[ json.room ]
})

app.post( "/trigger_custom" , async ( req , res ) => {
    const json = req.body
    const xi_opts = {
        voice_id : active_calls[ json.from ].elevenlabs_vid ,
        model : "eleven_multilingual_v2" ,
        outpath : `${WEB_DIR}/data/${json.group}/tx/${json.from}/AI_answer.mp3` ,
        to : json.from ,
        text : "Great! Let's start, can you tell me about your opinion on Coke?"
    }
    const b64_arr = [
        "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OwRAK2ob2fe1KZp+L04ztbamfyy0pKQpUnqPPFkj9MfBe2akjYgEDUaPscqTihRhSjyyBxCyBDbmVpGUZRCRMLKoy0xL/7QSmpLbttW26AcAqgyhMTHC9AXjYyURnx9dsqk2AlEkkuHx7q5crVMhyRHCkhK00R6HgWEx1YWJcKlWyyOUSVcwgAoVKIj5K4DSIKoXlLJli4lQNDUl3nHJv0eLGTZFirLmGyJI/FVE4EgsqcERvtIiEl2fYSJkdsobYPmjxLhLB+ilMgxJsyzqJY+siaNezyElXFmxdZQ1KSSyhMNCoeaETaSOLGLz5gDQwrPCUKsrKI0ywqRUsigt//9dTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVDkm9u3/9u15kcA0BoBAGgiEwwP1/969evbcosWGBwcHixW+3czOyWTyeWEjDBgYE//uSxOqAFPmfD6ww0eLrtGG0x6aEw8WaX7XaZZeKzuxUEE07fS7sniEGIGIGGOvT3TWe8IGQqN8Wnfbubtm2YUCECCM05M1cUZWtjZiBR9pkz0z5O/7UgYQQJ3fL216YSQQBEEMazyad+y0yBmSleIQfKaYOtPzhSCCCzWYEZERtCrLvrfuQiklcRBYVCoEhSKRSSsxQoUIqRIkSyIiFQqISVChQxQoSEiFRMiRIhUCQJAiGRSKRSKRShIUQCAQUlv7GkSM+v32t9USBgERmZk0jM1RIGAQCARIGIgEAgEJIkSJGtcijhxIkjnVIQqGSXIoUKFChFIpFKIiRNWhFJKzaqEhFIpFJKzaFDGpS9RQoYpCoVCpqMVUIpQ57WFQqJmrjGPlLxQkKFn+liImRSUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksTegBL9lxemGNkqy7OhfJMnXFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU="
    ]
    const backup_path = "/" + xi_opts.outpath.split( "/" ).slice( 8 , xi_opts.outpath.split( "/" ).length ).join( "/" )

    for (var i = 0; i <= b64_arr.length; i++) {

         await new Promise(resolve => setTimeout(resolve, 100))

        if ( i == b64_arr.length ) {
            const ret = JSON.stringify({ backup: backup_path, msg_name: "xi_finish" });
            active_calls[xi_opts.to].ws.send(ret);
            return res.status( 200 )
        }

        const metadata = JSON.stringify({ contentType: "audio" , msg_name: "xi_chunk_prep", });
        active_calls[xi_opts.to].ws.send(metadata);

        // const audioBuffer = Buffer.from(b64_arr[ i ], 'base64');
        // active_calls[xi_opts.to].ws.send(audioBuffer);

        active_calls[xi_opts.to].ws.send( JSON.stringify({ audio_b64 : b64_arr[ i ] , msg_name : "xi_chunk" }) );
    }

    // fetch_elevenlabs( xi_opts ).then( res.status( 200 ) )
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

app.get( '/test' , ( req , res ) => {
    res.sendFile( WEB_DIR + '/test.html' )
})

app.get( '/*' , (req , res) => {
    res.sendFile( WEB_DIR + '/index.html' )
})

wss.on( "connection" , ( ws , req ) => {

    const conn_url = new URL( req.url , WEB_DOMAIN )
    const id = conn_url.searchParams.get( "id" )

    active_calls[ id ].ws = ws

    ws.on( "message" , ( e ) => {
        const json = JSON.parse( e.toString( "utf-8" ) )

        if ( json.msg_name == "recording_end" ) {

            const audioBuffer = Buffer.from(json.audiob64, "base64");
            const qcnt = active_calls[ json.from ].question_cnt
            const audio_path = `${WEB_DIR}/data/${json.group}/tx/${json.from}/answer_${qcnt}.wav`

            fs.writeFile( audio_path , audioBuffer , ( err ) => {

                if ( err ) {
                    return console.error( `[W answer_${qcnt}.wav] ${json.from} answer_${qcnt}.wav failed` );
                    // return active_calls[ json.group ].ws.send( JSON.stringify( { from : json.from , msg_name : "ANSWER_W_ERR" } ) )
                }

                fetch_openai_transcript( audio_path ).then( ( transcript ) => {
                    const transcript_file = `${WEB_DIR}/data/${json.group}/tx/${json.from}/transcript.json`

                    fs.readFile( transcript_file , async ( err , transcript_data ) => {

                        if ( err ) {
                            return console.error( `[R transcript.json] ${json.group}/${json.from} read failed` )
                            // return active_calls[ json.group ].ws.send( JSON.stringify( { json.from , msg_name : "TRANSCRIPT_R_ERR" } ) )
                        }

                        let transcript_json = JSON.parse( transcript_data.toString( "utf-8" ) )
                        let assistant_opts = {}
                        let assistant_reply = null
                        let xi_opts = {}
                        transcript_json.transcript.push( transcript.text )

                        // active_calls[ json.group ].ws.send( JSON.stringify( { json.from , msg_name : "human_chat" } ) )

                        if ( active_calls[ json.from ].thread_id == null ) {
                            let messages = []
                            for (var i = 0; i < transcript_json.transcript.length; i++) {
                                messages.push( { role : ( i % 2 == 0 ) ? "assistant" : "user" , content : transcript_json.transcript[ i ] } )
                            }
                            assistant_opts = {
                                assistant_id : active_calls[ json.from ].assistant_id ,
                                thread_msgs : messages , 
                                group : json.group ,
                                action : "create_and_run"
                            }
                        } else {
                            assistant_opts = {
                                thread_id : active_calls[ json.from ].thread_id ,
                                message : { role : "user" , content : transcript_json.transcript[ transcript_json.transcript.length - 1 ] } ,
                                group : json.group ,
                                action : "create_message"
                            }
                        }

                        const res = await fetch_openai_assistant(assistant_opts);

                        if (assistant_opts.action === "create_and_run") {
                            active_calls[json.from].thread_id = res.thread_id;
                            assistant_reply = res.reply;
                        } else {
                            assistant_opts = {
                                thread_id: active_calls[json.from].thread_id,
                                assistant_id: active_calls[json.from].assistant_id,
                                group: json.group,
                                action: "create_run"
                            };

                            const res = await fetch_openai_assistant(assistant_opts);
                            assistant_reply = res.reply
                        }

                        xi_opts = {
                            voice_id : active_calls[ json.from ].elevenlabs_vid ,
                            model : "eleven_multilingual_v2" ,
                            outpath : `${WEB_DIR}/data/${json.group}/tx/${json.from}/AI_answer.mp3` ,
                            to : json.from
                        }

                        if ( assistant_reply == null ) {
                            console.error( `[OPENAI ERR] ${json.from} ${err}` )
                            xi_opts.text = "I'm sorry could you repeat that?"
                        } else {

                            xi_opts.text = assistant_reply
                            active_calls[ json.from ].question_cnt += 1

                            transcript_json.transcript.push( `${assistant_reply}` )
                            fs.writeFile( transcript_file , JSON.stringify( transcript_json ) , ( err ) => {
                                // active_calls[ json.group ].ws.send(
                                //     JSON.stringify( { from : json.from , text : assistant_reply , msg_name : "ai_chat" } )
                                // )
                            })
                        }

                        fetch_elevenlabs( xi_opts )
                    })
                })
            })
        }
    })
})
 
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
    const proj = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${opts.group}/config.json` ) )
    const openai_client = new openai({ 
        apiKey : obj.OPENAI_API_KEY ,
        project : proj.OPENAI_PROJECT
    })

    const handle_stream = async ( stream ) => {
        let assistant_reply = "";
        for await (const event of stream) {
            if (event.event === "thread.message.completed") {
                assistant_reply = event.data.content[0].text.value;
            }
            if (event.event === "thread.run.completed") {
                return { thread_id: event.data.thread_id, reply: assistant_reply };
            }
        }
    }

    switch (opts.action) {
        case "create_assistant":
            const myAssistant = await openai_client.beta.assistants.create({
                instructions: opts.instructions,
                name: opts.name,
                model: opts.model
            });
            return myAssistant.id;

        case "create_and_run":
            try {
                const streamCreateRun = await openai_client.beta.threads.createAndRun({
                    assistant_id: opts.assistant_id,
                    thread: { messages: opts.thread_msgs },
                    stream: true
                });
                return await handle_stream(streamCreateRun);
            } catch ( err ) {
                console.error( `[OPENAI CREATE_AND_RUN] ${err}` )
                return { reply : null }
            }

        case "create_message":
            await openai_client.beta.threads.messages.create(opts.thread_id, opts.message);
            return null;
        case "create_run":
            try {
                const streamRun = await openai_client.beta.threads.runs.create(opts.thread_id, {
                    assistant_id: opts.assistant_id,
                    stream: true
                });
                return await handle_stream(streamRun);
            } catch ( err ) {
                console.error( `[OPENAI CREATE RUN] ${err}` )
                return { reply : null }
            }

        default:
            throw new Error("Invalid action type");
    }
}

const fetch_elevenlabs = async( opts ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    const xi_uri = `wss://api.elevenlabs.io/v1/text-to-speech/${opts.voice_id}/stream-input?model_id=${opts.model}`
    const xi_ws = websocket = new WebSocket( xi_uri, {
        headers: { 'xi-api-key': `${obj.ELEVENLABS_API_KEY}` },
    });
    const mp3_header = ""

    xi_ws.on('open', () => {
        xi_ws.send(
            JSON.stringify({
                text: ' ',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.8,
                    use_speaker_boost: false,
                },
                generation_config: { chunk_length_schedule: [120, 160, 250, 290] }
            }),
        );

        xi_ws.send(JSON.stringify({ text: opts.text }));

        xi_ws.send(JSON.stringify({ text: '' }));
    });

    xi_ws.on( 'message' , ( e ) => {
        const data = JSON.parse( e )

        if ( data.isFinal == true ) {
            const ret = JSON.stringify({ msg_name: "xi_finish" });
            active_calls[opts.to].ws.send(ret);
        } else {
            const metadata = JSON.stringify({ contentType: "audio" , msg_name: "xi_chunk_prep", });
            active_calls[opts.to].ws.send(metadata);

            // const audioBuffer = Buffer.from(data.audio, 'base64');
            // active_calls[opts.to].ws.send(audioBuffer);

            const ret = JSON.stringify({ audio_b64 : data.audio , msg_name: "xi_chunk" })
            active_calls[ opts.to ].ws.send( ret )
        }
    })

    xi_ws.on( 'error' , ( e ) => {
        console.log( e )
        passThroughStream.end()
        fileStream.end()
    })
}

const main = async () => {

    await fs.readFile( `${BASE_DIR}/keys.json` , ( err , data ) => {
        if ( err ) { console.log( "where the keys at?" ); process.exit( 1 ) }

        keys = JSON.parse( data.toString( "utf-8" ) )
    })

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
