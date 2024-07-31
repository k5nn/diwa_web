let telnyx_client = null
let from_arr = []
let ws = new window.WebSocket( "wss://981a-2001-4452-4e0-b401-00-1001.ngrok-free.app:3000" )

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

const waitForOpenConnection = (socket) => {
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

function debug() {
}

document.addEventListener( 'readystatechange' , async ( e ) => {

	if ( e.target.readyState === "interactive" ) {
		store_cookies( e.target.cookie )
		ws = new window.WebSocket( `wss://${sessionStorage.getItem( "ngrok_url" )}` )
		telnyx_client = new TelnyxWebRTC.TelnyxRTC({
			login_token : sessionStorage.getItem( "telnyx_token" )
		});
	} else if ( e.target.readyState === "complete"  ) {
		await waitForOpenConnection( ws )
		telnyx_client.connect()
	}

})

ws.addEventListener( "message" , ( e ) => { //socket event from index.js

	if ( e.data == "" ) { return false }

	const json = JSON.parse( e.data )
	
	let client_state = null

	if ( json.data.hasOwnProperty( "client_state" ) ) {
		client_state = json.data.client_state
	}

	console.log( json )

	if ( json.rx == sessionStorage.getItem( "telnyx_receiver" ) ) {

		if ( json.msg_name == "call_answered" ) {
			let div = document.createElement( "div" )
			let span = document.createElement( "span" )
			div.classList.add( "chat_instance" )
			div.id = json.data.from
			div.innerHTML = `<div>${client_state.roomId}</div>`
			div.appendChild( span )
			document.querySelector( "#calls" ).appendChild( div )
		} else if ( json.msg_name == "ai_turn" ) {
			document.querySelector( `#${json.data.from} > span` ).innerHTML = "🤖"
		} else if ( json.msg_name == "human_turn" ) {
			document.querySelector( `#${json.data.from} > span` ).innerHTML = "👨"
		} else if ( json.msg_name == "assistance" ) {
			document.querySelector( `#${json.data.from} > span` ).innerHTML = "❗"
		} else if ( json.msg_name == "ai_chat" ) {
			document.querySelector( `#chat_rx` ).innerHTML += json.data
			document.querySelector( `#chat_rx` ).innerHTML += "\n"
		} else if ( json.msg_name == "human_chat" ) {
			document.querySelector( `#chat_tx` ).innerHTML += json.data
			document.querySelector( `#chat_tx` ).innerHTML += "\n"
		}
	}

	// if ( json.to != sessionStorage.getItem( "telnyx_receiver" ) ) { return false }

	// let data = e.data
	// let meta = e.meta
	// let event = data.event_type
	// let payload = data.payload
	// let client_state = JSON.parse( atob( payload.client_state ) )
	// let url_params = this.location.pathname.split( "/" )
	// let room_id = `_${client_state.roomId}`

	// if ( client_state.groupId != url_params[ 2 ] ) { return false }

	// if ( event == "call.initiated" ) {

	// 	if ( meta.attempt != 1 ) { return false }
		
	// 	let template = document.createElement( "div" )
	// 	template.classList.add( "chat_instance" )
	// 	template.id = room_id
	// 	template.innerHTML = `<div>${client_state.roomId}</div>`
	// 	calls.appendChild( template )
		
	// }

	// if ( event == "call.hangup" ) {
	// 	let calls = document.querySelector( "#calls" )
	// 	from_arr = from_arr.slice( from_arr.indexOf( treat_from( payload.from ) ) )
	// 	console.log( from_arr )
	// 	for (node of calls.childNodes) {
	// 		if ( node.id == room_id ) { calls.removeChild( node ) }		
	// 	}
	// }
	
})