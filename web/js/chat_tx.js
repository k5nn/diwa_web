let telnyx_client = null
let call = null

function store_cookies( cookie_str ) {
	let cookies = cookie_str.split( ";" )

	for (var i = 0; i < cookies.length; i++) {
		const kvp = cookies[i].split( "=" )
		const treat = ( string ) => { return ( string ).trim() }
		let value = ""

		for (var j = 1; j < kvp.length; j++) { value += kvp[j] }
		
		sessionStorage.setItem( `${ treat( kvp[ 0 ] ) }` , treat( value ) )
	}
}

function init_call() {
	let url_params = this.location.pathname.split( "/" ) 
	call = telnyx_client.newCall({
		clientState : btoa( `{ "groupId" : "${url_params[2]}" , "roomId" : "${url_params[3]}" }` ) ,
		destinationNumber : sessionStorage.getItem( "telnyx_receiver" )
	})
}

function drop_call() {
	if ( !call ) { return alert( "no call in progress" );  }
	call = null
	telnyx_client.disconnect()
	telnyx_client.connect()
}

document.addEventListener( 'readystatechange' , ( e ) => {

	if ( e.target.readyState === "interactive" ) {
		store_cookies( e.target.cookie )
		telnyx_client = new TelnyxWebRTC.TelnyxRTC({
			login_token : sessionStorage.getItem( "telnyx_token" )
		});
	} else if ( e.target.readyState === "complete"  ) {
		telnyx_client.connect()
		telnyx_client.remoteElement = "remoteMedia"
	}

})

