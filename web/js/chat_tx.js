let telnyx_client = null
let call = null
let ws = null

function store_cookies( cookie_str ) {
	let cookies = cookie_str.split( ";" )
	const url_params = this.location.pathname.split( "/" )
	sessionStorage.setItem( "groupId" , url_params[ 2 ] )
	sessionStorage.setItem( "roomId" , url_params[ 3 ] )

	for (var i = 0; i < cookies.length; i++) {
		const kvp = cookies[i].split( "=" )
		const treat = ( string ) => { return ( string ).trim() }
		let value = ""

		for (var j = 1; j < kvp.length; j++) { value += kvp[j] }
		
		sessionStorage.setItem( `${ treat( kvp[ 0 ] ) }` , treat( value ) )
	}

	// console.log( sessionStorage )
}

function init_call() {
	call = telnyx_client.newCall({
		clientState : btoa( `{ "groupId" : "${sessionStorage.getItem( "groupId" )}" , "roomId" : "${sessionStorage.getItem( "roomId" )}" }` ) ,
		destinationNumber : sessionStorage.getItem( "telnyx_receiver" )
	})
	document.querySelector( "#state" ).innerHTML = "Call Start"
}

function drop_call() {
	if ( !call ) { return alert( "no call in progress" ); }
	call.hangup()
	call = null
	document.querySelector( "#state" ).innerHTML = `Call Hangup`
}

function trigger_custom() {
	// sendMessage( ws , JSON.stringify ( { test : "eyyy" } ) )
	// let f32arr = new Float32Array()
	// let u8arr = new Uint8Array()

	// console.log( f32arr = [ 0.923456 , 0.123456 , 0.345670 , 0.102935 ] )
	// console.log( f32arr.BYTES_PER_ELEMENT ); // 4

	const dummy_data = { 
		call_control_id: "v3:WvGbIsba_oVmqCQhdvd408nqodXwUYb8R_4ukajnOfV2sWtsBiZDnQ", 
		from: "gencredX5BqUWja7BfJjFhdqOhTqEKcuBVs3rcSLFiudPDB8J", 
		to: "gencred70vBu4lyvAlcCFVMUGwIm3S6NugalcPlErw6kxHcyK",
		client_state: { groupId: "test_campaign", roomId: "20ae3c60-ec27-4043-81f6-5acd3b9077dd" }
	}
	init_vad( 3 , dummy_data )

	// sendMessage( ws , JSON.stringify( { audio64 : btoa( ( f32arr.from( "test_node" ).buffer ) ) , msg_name : "record_end" } ) )
	// fetch( "/trigger_custom" )
}

const init_vad = async ( silence_seconds , call_data ) => {
	const calc_frames = ( seconds ) => { return Math.floor( ( 16000/1536 ) * seconds ) }
	const positive_rate = 0.75
	let init_time = Date.now()
	let vad_start_msg = {
		rx : sessionStorage.getItem( "telnyx_receiver" ) ,
		data : call_data ,
		msg_name: "human_turn" ,
	}
	let myvad = null

	const handleSpeechEnd = (audio) => {
		const wavBuffer = vad.utils.encodeWAV(audio)
		const base64 = vad.utils.arrayBufferToBase64(wavBuffer)
    	const ws_msg = { 
    		audiob64: base64 ,
    		data : call_data ,
    		msg_name: "recording_end"
    	}
        sendMessage(ws, JSON.stringify( ws_msg ));
        myvad.pause();
        document.querySelector( "#state" ).innerHTML = `Listening : ${myvad.listening}`
	};

	myvad = await vad.MicVAD.new({
        onSpeechEnd: handleSpeechEnd,
        positiveSpeechThreshold: positive_rate,
        redemptionFrames: calc_frames( silence_seconds ),
    });
    window.myvad = myvad

    // Start voice activity detection
    await sendMessage(ws, JSON.stringify( vad_start_msg ) );
    myvad.start();
    document.querySelector( "#state" ).innerHTML = `Listening : ${myvad.listening}`
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

document.addEventListener( 'readystatechange' , async ( e ) => {

	if ( e.target.readyState === "interactive" ) {
		store_cookies( e.target.cookie )
		ws = new window.WebSocket( `wss://${sessionStorage.getItem( "ngrok_url" )}` )
		telnyx_client = new TelnyxWebRTC.TelnyxRTC({
			login_token : sessionStorage.getItem( "telnyx_token" )
		});
		vad.MicVAD.new()
	} else if ( e.target.readyState === "complete"  ) {

		waitForOpenConnection( ws )
			.then( () => {
				document.querySelector( "body" ).style.display = "flex"
			})

		telnyx_client.remoteElement = "remoteMedia"
		telnyx_client.connect()

		ws.addEventListener( "message" , ( e ) => {

			if ( e.data == "" ) { return false }

			const json = JSON.parse( e.data )
			console.log( json )

			if ( json.rx == sessionStorage.getItem( "telnyx_sip" ) ) {

				if ( json.msg_name == "start_vad" ) {
					init_vad( 3 , json.data )
				}

			}
		})
	}

})



