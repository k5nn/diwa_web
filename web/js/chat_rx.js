let ws = null
let rtc_conn = null
const rtc_config = { "iceServers": [{ "credential" : "test123" , "urls": "turn:188.166.191.65" , "username" : "test" }] }; 

function store_cookies( cookie_str ) {
	let cookies = cookie_str.split( ";" )

	for (var i = 0; i < cookies.length; i++) {
		const kvp = cookies[i].split( "=" )
		const treat = ( string ) => { return ( string ).trim() }
		let value = ""
		

		for (var j = 1; j < kvp.length; j++) { value += kvp[j] }
		
		sessionStorage.setItem( `${ treat( kvp[0] ) }` , treat( value ) )
	}

	console.log( sessionStorage )
}

const wait_ws_open = (socket) => {
    return new Promise((resolve, reject) => {
        const maxNumberOfAttempts = 10
        const intervalTime = 200 //ms

        let currentAttempt = 0
        const interval = setInterval(() => {
            if (currentAttempt > maxNumberOfAttempts - 1) {
                clearInterval(interval)
                reject(new Error('Maximum number of attempts exceeded'))
            } else if (socket.readyState === socket.OPEN) {
                clearInterval(interval)
                resolve()
            }
            currentAttempt++
        }, intervalTime)
    })
}

const wait_rtc_open = ( conn ) => {
	return new Promise( ( resolve , reject ) => {
		const maxNumberOfAttempts = 10
		const intervalTime = 500

		let currentAttempt = 0
		const interval = setInterval( () => {
			if ( currentAttempt > maxNumberOfAttempts - 1 && conn.connectionState == "connecting"){
				clearInterval( interval )
				reject( new Error( 'WebRTC Max Connection Attempts Reacher' ) ) 
			} else if ( conn.connectionState == "connected" ) {
				clearInterval(interval)
				resolve()
			} else if ( conn.connectionState == "failed" ) {
				clearInterval( interval )
				reject( new Error( 'WebRTC Connection Attempt Failed' ) )
			}
			console.log( "Connecting" )
			console.log( conn.connectionState )
			currentAttempt++
		}, intervalTime)
	})
}

const sendMessage = async (socket, msg) => {
    if (socket.readyState !== socket.OPEN) {
        try {
            await waitForOpenConnection(socket)
            socket.send(msg)
        } catch (err) { console.error(err) }
    } else {
        socket.send(msg)
    }
}

const start_rtc = ( localstream , remoteaudio ) => {
	const rtc_cfg = { "iceServers": [
		{ "credential" : "test123" , "urls": ["turn:turn.diwa.ai" , "turn:188.166.191.65"] , "username" : "test" } ,
		{ "urls" : 'stun:stun.l.google.com:19302' }
	] }; 
	let rtc_conn = new RTCPeerConnection(rtc_cfg)

	localstream.getTracks().forEach( track => rtc_conn.addTrack( track , localstream ) )

	rtc_conn.ontrack = event => {
		remoteaudio.srcObject = event.streams[ 0 ]
	}

	rtc_conn.onicecandidate = event => {
		if ( event.candidate ) { 
			console.log( event )
			ws.send( JSON.stringify( { type : "offer_candidate" , candidate : event.candidate , group : groupId , room : roomId } ) ) 
		}
	}

	rtc_conn.createOffer().then( offer => {
		rtc_conn.setLocalDescription( offer ).then( () => {
			console.log( offer )
			// ws.send( JSON.stringify( offer ) )
		})
	})
}

document.addEventListener( 'readystatechange' , async ( e ) => {

	if ( e.target.readyState === "interactive" ) {
		store_cookies( e.target.cookie )
		ws = new window.WebSocket( `wss://${sessionStorage.getItem( "web_url" )}` )
	} else if ( e.target.readyState === "complete"  ) {

		const hasUserMedia = () => {
			return !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia); 
		}

		if ( ! hasUserMedia ) { return alert( "WebRTC not supported" ) }

		let body = document.querySelector( "body" )

		body.style.display = "flex"

		// navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia; 
		// navigator.getUserMedia( { audio: true } , 
		// 	( stream ) => {
		// 		console.log( audio )
		// 	} , 
		// 	( err ) => { 
		// 		console.log( err ) 
		// 	}
		// )

		wait_ws_open( ws ).then( wss => {
			rtc_conn = new RTCPeerConnection(rtc_config)

			rtc_conn.onicecandidate = ( e ) => {(
				wss.send(  )
			)}
		})


		// waitForOpenConnection( ws )
		// 	.then( () => {
		// 		document.querySelector( "body" ).style.display = "flex"
		// 	})

		// ws.addEventListener( "message" , ( e ) => { //socket event from index.js

		// 	if ( e.data == "" ) { return false }

		// 	const json = JSON.parse( e.data )
		// 	console.log( json )
			
		// 	let client_state = null

		// 	if ( json.data.hasOwnProperty( "client_state" ) ) {
		// 		client_state = json.data.client_state
		// 	}


		// 	if ( json.rx == sessionStorage.getItem( "telnyx_receiver" ) ) {

		// 		if ( json.msg_name == "call_answered" ) {
		// 			let div = document.createElement( "div" )
		// 			let span = document.createElement( "span" )
		// 			div.classList.add( "chat_instance" )
		// 			div.id = json.data.from
		// 			div.innerHTML = `<div>${client_state.roomId}</div>`
		// 			div.appendChild( span )
		// 			document.querySelector( "#calls" ).appendChild( div )
		// 		} else if ( json.msg_name == "ai_turn" ) {
		// 			document.querySelector( `#${json.data.from} > span` ).innerHTML = "🤖"
		// 		} else if ( json.msg_name == "human_turn" ) {
		// 			document.querySelector( `#${json.data.from} > span` ).innerHTML = "👨"
		// 		} else if ( json.msg_name == "assistance" ) {
		// 			document.querySelector( `#${json.data.from} > span` ).innerHTML = "❗"
		// 		} else if ( json.msg_name == "ai_chat" ) {
		// 			document.querySelector( `#chat_rx` ).innerHTML += `${json.data}<br>`
		// 		} else if ( json.msg_name == "human_chat" ) {
		// 			document.querySelector( `#chat_tx` ).innerHTML += `${json.data}<br>`
		// 		}
		// 	}
		// })
	}

})