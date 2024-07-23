let telnyx_client = null
let socket = io();
let from_arr = []

function store_cookies( cookie_str ) {
	let cookies = cookie_str.split( ";" )

	for (var i = 0; i < cookies.length; i++) {
		let value = ""
		let kvp = cookies[i].split( "=" )

		for (var i = 1; i < kvp.length; i++) { value += kvp[i] }
		
		sessionStorage.setItem( `${kvp[0]}` , value )
	}
}

document.addEventListener( 'readystatechange' , ( e ) => {

	if ( e.target.readyState === "interactive" ) {
		store_cookies( e.target.cookie )
		telnyx_client = new TelnyxWebRTC.TelnyxRTC({
			login_token : sessionStorage.getItem( "telnyx_token" )
		});
	} else if ( e.target.readyState === "complete"  ) {
		telnyx_client.connect()
	}

})

socket.on( "telnyx_event" , ( e ) => { //socket event from index.js
	let data = e.data
	let meta = e.meta
	let event = data.event_type
	let payload = data.payload
	let client_state = JSON.parse( atob( payload.client_state ) )
	let url_params = this.location.pathname.split( "/" )
	let room_id = `_${client_state.roomId}`

	if ( client_state.groupId != url_params[ 2 ] ) { return false }

	let fetch_headers = { "content-type" : "application/json" }
	let fetch_opts = {
		headers : fetch_headers ,
		method : "POST" ,
		body : JSON.stringify( e )
	}
	let treat_from = ( dirty_from ) => { return dirty_from.split( "@" )[ 0 ] }

	if ( event == "call.initiated" ) {

		if ( meta.attempt != 1 && from_arr.includes( treat_from( payload.from ) ) ) { return false }
		
		if ( payload.direction == "incoming" ) { 
			let template = document.createElement( "div" )
			template.classList.add( "chat_instance" )
			template.id = room_id
			template.innerHTML = `<div>${client_state.roomId}</div>`
			calls.appendChild( template )
		} else {
			console.log( "answering call" )
			fetch( "/telnyx/actions" , fetch_opts )
				.then( ( res ) => res.json())
				.then( ( json ) => {
					from_arr.push( treat_from( payload.from ) )
					console.log( json )
					console.log( from_arr )
				})
		}
	}

	if ( event == "call.answered" ) {

		if ( meta.attempt != 1 && from_arr.includes( treat_from( payload.from ) ) ) { return false }
		
		fetch( "/telnyx/actions" , fetch_opts )
			.then( ( res ) => res.json() )
			.then( ( json ) => {
				console.log( "starting audio playback" )
				console.log( json )
			})
	}

	if ( event == "call.playback.ended" ) {
		console.log( "playback ended" )
	}

	if ( event == "call.hangup" ) {
		let calls = document.querySelector( "#calls" )
		from_arr = from_arr.slice( from_arr.indexOf( treat_from( payload.from ) ) )
		console.log( from_arr )
		for (node of calls.childNodes) { 
			if ( node.id == room_id ) { calls.removeChild( node ) }		
		}
	}
	
})