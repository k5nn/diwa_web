document.addEventListener( 'readystatechange' , async ( e ) => {

    if ( e.target.readyState === "interactive" ) {
      console.log( "here" ) 
    } else if ( e.target.readyState === "complete" ) {
      console.log( "there" )
    }

})