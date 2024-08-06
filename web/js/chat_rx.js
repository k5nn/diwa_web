let telnyx_client = null
let from_arr = []
let ws = null

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
		waitForOpenConnection( ws )
			.then( () => {
				document.querySelector( "body" ).style.display = "flex"
			})

		telnyx_client.connect()

		ws.addEventListener( "message" , ( e ) => { //socket event from index.js

			if ( e.data == "" ) { return false }

			const json = JSON.parse( e.data )
			console.log( json )
			
			let client_state = null

			if ( json.data.hasOwnProperty( "client_state" ) ) {
				client_state = json.data.client_state
			}


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
					document.querySelector( `#chat_rx` ).innerHTML += `${json.data}<br>`
				} else if ( json.msg_name == "human_chat" ) {
					document.querySelector( `#chat_tx` ).innerHTML += `${json.data}<br>`
				}
			}
		})
	}

})