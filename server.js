// WhiskChat Server! :D

var io = require('socket.io').listen(Number(process.env.PORT));
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var sockets = [];
var online = 0;
var lastSendOnline = new Date(); //throttle online requests

// For Heroku:
io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10); 
});
console.log('info - WhiskChat Server starting');
console.log('info - Starting DB');
if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);
    var db = redis.createClient(rtg.port, rtg.hostname);
    
    db.auth(rtg.auth.split(":")[1]);
} else {
    var db = redis.createClient();
}
db.on('error', function(err) {
    console.log('error - DB error: ' + err);
});
function handle(err) {
    console.log('error - ' + err);
    try {
        sockets.forEach(function(socket) {
	    socket.emit({room: 'main', message: 'Server error: ' + err, user: '[server]', timestamp: Date.now()});
	});
    }
    catch(e) {
	console.log('error - couldn\'t notify sockets: ' + e);
    }
}
db.on('ready', function() {
	console.log('info - DB connected');
	io.sockets.on('connection', function(socket) {
	    sockets.push(socket);
	    online++;
	    if(lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000){
		io.sockets.volatile.emit("onine", {people: online});
		lastSendOnline = new Date();
	    } else {
		socket.emit("online", {people: online});
	    }
	    socket.on('disconnect', function() {
		sockets.splice(sockets.indexOf(socket), 1);
		online--;
	    });
	    socket.emit('joinroom', {room: 'main'});
            socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong>', user: '[server]', timestamp: Date.now()});
            socket.emit('chat', {room: 'main', message: 'WhiskChat uses code from <a href="coinchat.org">coinchat.org</a>, (c) 2013 admin@glados.cc', user: '[server]', timestamp: Date.now()});
            socket.emit('chat', {room: 'main', message: 'Please authenticate using the link at the top.', user: '[server]', timestamp: Date.now()});
	    socket.authed = false;
	    socket.on('accounts', function(data) {
		if(data && data.action){
		    if(data.action == "register"){
			if(data.username && data.password && data.password2 && data.email){
			    if(data.username.length < 3 || data.username.length > 16 || data.username.test(/^[a-z0-9]+$/i)){
				return socket.emit("message", {type: "alert-error", message: "Username must be between 3 and 16 characters, and must be alphanumeric"});
			    }
			    db.get("users/" + data.username, function(err, reply){
				if(!reply){
				    if(data.password.length < 6){
					return socket.emit("message", {type: "alert-error", message: "Password must be at least 6 characters!"});
				    }
				    if(data.email.indexOf("@") == -1 || data.email.indexOf(".") == -1){
					//simple email check
					return socket.emit("message", {type: "alert-error", message: "Please enter a valid email."});
				    }
				    if(data.password != data.password2){
					return socket.emit("message", {type: "alert-error", message: "Passwords must match!"});
				    }
				    // Generate seed for password
				    crypto.randomBytes(12, function(ex, buf){
					var salt = buf.toString('hex');
					
					var hashed = hash.sha256(data.password, salt);
					
					db.set("users/" + data.username, true);
					db.set("users/" + data.username + "/password", hashed);
					db.set("users/" + data.username + "/salt", salt);
					db.set("users/" + data.username + "/email", data.email);
					
					socket.emit("message", {type: "alert-success", message: "Thanks for registering, " + data.username + "!"});
				    });
				} else {
				    return socket.emit("message", {type: "alert-error", message: "The username is already taken!"});
				}
			    });
			} else {
			    socket.emit("message", {type: "alert-error", message: "Please fill in all the fields."});
			}
		    }
		}
	    });
	    socket.on('chat', function(data) {
		if (!socket.authed) {
                    socket.emit('chat', {room: 'main', message: 'Please log in or register to chat!', user: '[server]', timestamp: Date.now()});
		}
	    });
	});
	console.log('info - listening');
});
