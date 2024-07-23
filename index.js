const express = require('express')
const fs = require( 'fs' )
const https = require( 'https' )
const http = require( 'http' )
const { networkInterfaces } = require('os');
const { v4: uuidv4 } = require('uuid');
const { Server } = require("socket.io");
const fsPromises = fs.promises;

const app = express()
const server = http.createServer(app);
const io = new Server(server);

const nets = networkInterfaces();
const port = 3000
const BASE_DIR = __dirname
const WEB_DIR = `${BASE_DIR}/web`
const NGROK_DOMAIN = "https://915e-124-104-1-173.ngrok-free.app"
const GRP_NAME = "test_campaign"
const network_info = {}
let telnyx = null

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
//system

app.use(express.json()) // for parsing application/json

app.get( '/rooms/:groupId' , ( req , res ) => {
    res.redirect( `/rooms/${GRP_NAME}/${uuidv4()}` )
})

app.get( '/campaigns/:groupId' , async ( req , res ) => {
    let token = await telnyx_token( req.params )
    
    if ( token.hasOwnProperty( "err" ) ) { 
        console.log( token.err )
        return res.status( 404 )
    }

    res.cookie( "telnyx_token" , token , { expires : 0 } )
    return res.sendFile( WEB_DIR + '/chat_rx.html' )
})

app.get( '/rooms/:groupId/:roomId' , async ( req , res ) => {
    let token = await telnyx_token(  req.params )
    let receiver_cred = JSON.parse( await fsPromises.readFile( `${WEB_DIR}/data/${req.params.groupId}/telnyx_credentials.json` ) )

    if ( token.hasOwnProperty( "err" ) ) { 
        console.log( token.err )
        return res.status( 404 ) 
    }

    res.cookie( "telnyx_receiver" , receiver_cred.data.sip_username , { expires : 0 } )
    res.cookie( "telnyx_token" , token , {expires : 0} )
    return res.sendFile( WEB_DIR + '/chat_tx.html' )
})

app.post( "/telnyx/events" , async ( req , res ) => {
    io.emit( "telnyx_event" , req.body ) // throw to socket on chat_rx html for redirect to telynx_actions
})

app.post( "/telnyx/actions" , async ( req , res ) => {
    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )
    let data = req.body.data
    let meta = req.body.meta
    let payload = data.payload
    let b64buffer = Buffer.from( payload.client_state , "base64" )
    let json_client_state = JSON.parse( b64buffer.toString( "utf-8" ) )
    let fetch_opts = {
        api_key : obj.TELNYX_API_KEY ,
    }
    let ret = null

    console.log( data )

    if ( data.event_type == "call.initiated" && payload.direction == "outgoing" ) { 
        fetch_opts.body = JSON.stringify( {} )
        fetch_opts.url = `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`
    }

    if ( data.event_type == "call.answered" ) {
        let audiobuff = await fsPromises.readFile( `${WEB_DIR}/data/${json_client_state.groupId}/Greeting.mp3` )
        fetch_opts.body = JSON.stringify( {
            audio_url: `${NGROK_DOMAIN}/data/${json_client_state.groupId}/Greeting.mp3`,
            loop: 1,
            client_state: payload.client_state
        })
        fetch_opts.url = `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/playback_start`
    }

    if ( ! fetch_opts.url ) { return res.status( 200 ).json( {} ) }

    ret = await fetch_telnyx( fetch_opts )

    if ( ret.errors ) {
        console.log( fetch_opts )
        console.log( ret )
        io.emit( "telnyx_error" , payload.client_state )
        return process.exit( 2 )
    } else {
        return res.status( 200 ).json( ret )
    }

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

io.on('connection', (socket) => {
    console.log('a user connected');
});

io.on('data' , ( data ) => {
    console.log( data )
})

// const fetch_telnyx_creds = async ( telnyx_auth ) => {
//     let fetch_opts = {
//         method : "POST" ,
//         headers : {telnyx_token
//             "Content-Type" : "application/json" ,
//             "Authorization" : `Bearer ${telnyx_auth.api_key}`
//         } ,
//         body : JSON.stringify( { "connection_id" : telnyx_auth.sip_id } )
//     }

//     let res = await fetch( "https://api.telnyx.com/v2/telephony_credentials" , fetch_opts )
//     return res.json()
// }

// const fetch_telnyx_token = async ( telnyx_auth , cred_id ) => {
//     let fetch_opts = {
//         method : "POST" ,
//         headers : {
//             "Content-Type" : "Application/Json" ,
//             "Authorization" : `Bearer ${telnyx_auth.api_key}`
//         } ,
//         body : JSON.stringify( {} )
//     }

//     let res = await fetch( `https://api.telnyx.com/v2/telephony_credentials/${cred_id}/token` , fetch_opts )
//     return res.text()
// }

const fetch_telnyx = async( opts ) => {
    let fetch_opts = {
        method : "POST" ,
        headers : {
            "Content-Type" : "Application/Json" ,
            "Authorization" : `Bearer ${opts.api_key}`
        } ,
        body : opts.body
    }
    let res = await fetch( opts.url , fetch_opts )

    if ( opts.rettype == "str" ) { return res.text() }

    return res.json()
}

const telnyx_token = async( params ) => {
    let telnyx_auth_obj = {
        api_key : null ,
        sip_id : null
    }
    let fpath = WEB_DIR
    fpath += ( params.roomId ) ? `/data/${params.groupId}/tx/${params.roomId}` : `/data/${params.groupId}/`

    if ( ! await async_file_check( fpath ) ) { await fsPromises.mkdir( fpath , { recursive : true } ) }

    if ( ! await async_file_check( `${BASE_DIR}/keys.json` ) ) { console.log( "WHERE THE KEYS AT" ); process.exit( 1 ) }

    const obj = JSON.parse( await fsPromises.readFile( `${BASE_DIR}/keys.json` ) )

    if ( ! await async_file_check( `${fpath}/telnyx_credentials.json` ) ) {
        let fetch_opts = {
            api_key : obj.TELNYX_API_KEY ,
            body : JSON.stringify( { connection_id : `${ (params.roomId) ? obj.CANDIDATE_SIP_PAIR.tx : obj.CANDIDATE_SIP_PAIR.rx }` } ) ,
            url : "https://api.telnyx.com/v2/telephony_credentials" 
        }
        await fsPromises.writeFile( `${fpath}/telnyx_credentials.json` , JSON.stringify( ( await fetch_telnyx( fetch_opts ) ) , null , "\t" ) )
    }
    let telnyx_cred = JSON.parse( await fsPromises.readFile( `${fpath}/telnyx_credentials.json` ) )

    if ( ! await async_file_check( `${fpath}/telnyx_token.txt` ) ) {
        let fetch_opts = {
            api_key : obj.TELNYX_API_KEY ,
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

const async_file_check = async (path) => {
    try {
        await fsPromises.access( path )
        return true
    } catch {
        return false
    }
};

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
