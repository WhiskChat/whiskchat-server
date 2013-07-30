// WhiskChat Server! :D

var io = require('socket.io').listen(Number(process.env.PORT));
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var sockets = [];
var online = 0;
var bbcode = require('bbcode');
var mods = ['whiskers75', 'admin', 'peapodamus', 'TradeFortress'];
var lastSendOnline = new Date(); //throttle online requests
var versionString = "WhiskChat Server beta v0.1";
var alphanumeric = /^[a-z0-9]+$/i;
var muted = [];

io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10);
    io.set('log level', 1);
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
function stripHTML(html) {
    return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>?/gi, '[stripped HTML]');
}
function login(username, usersocket) {
    online++;
    usersocket.emit('loggedin', {username: username});
    usersocket.authed = true;
    usersocket.emit('chat', {room: 'main', message: 'Signed in as ' + username + '!', user: '[server]', timestamp: Date.now()});
    db.get('motd', function(err, reply) {
	if (reply) {
	    var motd = reply.split('|');
	    motd.forEach(function(line) {
                usersocket.emit('chat', {room: 'main', message: line, user: '[MOTD]', timestamp: Date.now()});
	    });
	}
    });
    usersocket.user = username;
    usersocket.emit('chat', {room: 'main', message: 'The version here is ' + versionString + '. ' + online + ' users connected.', user: '[MOTD]', timestamp: Date.now()});
    usersocket.emit('chat', {room: 'main', message: 'The latest source code is <a href="https://github.com/WhiskTech/whiskchat-server/">here</a>.', user: '[MOTD]', timestamp: Date.now()});
    usersocket.emit('chat', {room: 'main', message: 'Oh hai. <button onclick="$("#vidQvxdDDHElZo").show()" class="btn btn-mini btn-success">Play</button><button onclick="$("#vidQvxdDDHElZo").hide()" class="btn btn-mini btn-danger">Hide</button><iframe id="vidQvxdDDHElZo" style="" width="560" height="315" src="//www.youtube.com/embed/QvxdDDHElZo" frameborder="0" allowfullscreen=""></iframe>', user: '[MOTD]', timestamp: Date.now()});
    usersocket.emit('joinroom', {room: 'whiskchat'});
    usersocket.emit('whitelist', {whitelisted: 1});
    db.get('users/' + username + '/balance', function(err, reply) {
	usersocket.emit('balance', {balance: reply});
        usersocket.emit('chat', {room: 'main', message: 'Your balance is ' + reply + ' mBTC. I haven\'t implemented whitelist yet :P', user: '[MOTD]', timestamp: Date.now()});
    });
    console.log('user ' + username + ' just logged in! :D');
}
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
});
io.sockets.on('connection', function(socket) {
    sockets.push(socket);
    
    if(lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000){
	io.sockets.volatile.emit("online", {people: online});
	lastSendOnline = new Date();
    } else {
	socket.emit("online", {people: online});
    }
    socket.on('disconnect', function() {
	sockets.splice(sockets.indexOf(socket), 1);
	if (socket.authed) {
	    online--;
	}
    });
    socket.emit('joinroom', {room: 'main'});
    socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong> (beta)', user: '[server]', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'WhiskChat uses code from <a href="http://coinchat.org">coinchat.org</a>, (c) 2013 admin@glados.cc', user: '[server]', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'Please authenticate using the link at the top.', user: '[server]', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'Supported features: login, register', user: '[server]', timestamp: Date.now()});
    socket.authed = false;
    socket.on('accounts', function(data) {
	if(data && data.action){
	    if(data.action == "register"){
		if(data.username && data.password && data.password2 && data.email){
		    if(data.username.length < 3 || data.username.length > 16 || data.username == "[server]"){
			return socket.emit("message", {type: "alert-error", message: "Username must be between 3 and 16 characters"});
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
				login(data.username, socket);
			    });
			} else {
			    return socket.emit("message", {type: "alert-error", message: "The username is already taken!"});
			}
		    });
		} else {
		    socket.emit("message", {type: "alert-error", message: "Please fill in all the fields."});
		}
	    }
	    if (data.action == "login") {
		db.get("users/" + data.username + "/password", function(err, reply) {
		    if (err) {
			handle(err);
		    }
		    
		    else {
                        if (reply.indexOf("Nuked: ") !== -1) {
                            return socket.emit("message", {type: "alert-error", message: "You have been nuked! " + reply}); 
                        }
			db.get('users/' + data.username + '/salt', function(err, salt) {
                            var hashed = hash.sha256(data.password, salt);
			    if (reply == hashed) {
                                socket.emit("message", {type: "alert-success", message: "Welcome back, " + data.username + "!"});
				login(data.username, socket);
			    }
			    else {
				if (reply == null) {
				    socket.emit("message", {type: "alert-error", message: "User does not exist."});
				}
				else {
                                    socket.emit("message", {type: "alert-error", message: "Incorrect password."});
				}
			    }
			});
		    }
		});
	    }
	}
    });
    socket.on('mute', function(mute) {
	if (mods.indexOf(socket.user) == -1) {
            socket.emit("message", {type: "alert-error", message: "You are not a moderator!"});
	}
	else {
	    if (muted.indexOf(mute.target) == -1) {
		muted.push(mute.target);
	    }
	    sockets.forEach(function(cs) {
		cs.emit('chat', {room: 'main', message: '<span class="label label-important">' + stripHTML(mute.target) + ' has been muted by ' + stripHTML(socket.user) + ' for ' + stripHTML(mute.mute) + ' seconds! Reason: ' + stripHTML(mute.reason) + '</span>', user: '[server]', timestamp: Date.now()});
	    });
	    setTimeout(function() {
		muted.splice(muted.indexOf(mute.target), 1);
		sockets.forEach(function(cs) {
                    cs.emit('chat', {room: 'main', message: '<span class="label label-important">' + mute.target + '\'s mute expired!</span>', user: '[server]', timestamp: Date.now()});
		});
	    }, mute.mute * 1000);
	}
    });
    socket.on('chat', function(chat) {
	if (!socket.authed) {
            socket.emit('chat', {room: 'main', message: 'Please log in or register to chat!', user: '[server]', timestamp: Date.now()});
	}
	else {
            sockets.forEach(function(cs) {
		if (muted.indexOf(socket.user) !== -1) {
                    socket.volatile.emit("message", {type: "alert-error", message: "You have been muted!"});
		    return;
                }
		if (chat.message.length < 2) {
		    return;
		}
		if (chat.message.substr(0, 1) == "\\") {
                    return cs.emit('chat', {room: chat.room, message: '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 1.1em;">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', user: socket.user, timestamp: Date.now()});
		}
                if (chat.message.substr(0, 1) == "|") {
                    return cs.emit('chat', {room: chat.room, message: '<span class="rainbow">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', user: socket.user, timestamp: Date.now()});
                }
                if (chat.message.substr(0, 3) == "/me") {
                    return cs.emit('chat', {room: chat.room, message: '<i>' + stripHTML(chat.message.substr(4, chat.message.length)) + '</i>', user: socket.user, timestamp: Date.now()});
                }
                if (chat.message.substr(0, 3) == "/yt") {
                    return cs.emit('chat', {room: chat.room, message: '<span style="display: inline;" id="y' + stripHTML(chat.message.substr(4, chat.message.length)) + '">YouTube Video</span> (ID: ' + stripHTML(chat.message.substr(4, chat.message.length)) + ') <button onclick="$(\'#vid' + stripHTML(chat.message.substr(4, chat.message.length)) +'\').hide()" class="btn btn-small btn-danger">Hide</button> <button onclick="$(\'#vid' + stripHTML(chat.message.substr(4, chat.message.length)) + '\').show()" class="btn btn-small btn-success">Show</button><iframe id="vid' + stripHTML(chat.message.substr(4, chat.message.length)) + '" style="display: none;" width="560" height="315" src="//www.youtube.com/embed/' + stripHTML(chat.message.substr(4, chat.message.length)) + '" frameborder="0" allowfullscreen></iframe> <script>function ytcallback' + stripHTML(chat.message.substr(4, chat.message.length)) +'() {$(\'#yt' + stripHTML(chat.message.substr(4, chat.message.length)) +'\').html(data.entry["title"].$t)}</script><script type="text/javascript" src="http://gdata.youtube.com/feeds/api/videos/' + stripHTML(chat.message.substr(4, chat.message.length)) +'?v=2&alt=json-in-script&callback=ytcallback' + stripHTML(chat.message.substr(4, chat.message.length)) +'"></script>', user: socket.user, timestamp: Date.now()});
                }
                if (chat.message.substr(0,3) == "/ma") {
                    if (mods.indexOf(socket.user) == -1) {
                        socket.emit("message", {type: "alert-error", message: "You are not a moderator!"});
		    }
                    else {
                        return cs.emit('chat', {room: chat.room, message: '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 2em; color: red;">' + stripHTML(chat.message.substr(3, chat.message.length)) + '</span>', user: socket.user, timestamp: Date.now()});
		    }
                }
		bbcode.parse(stripHTML(chat.message), function(parsedcode) {
		    /* link links */
		    parsedcode = urlify(parsedcode);
		    cs.emit('chat', {room: chat.room, message: parsedcode, user: socket.user, timestamp: Date.now()});
		});
	    });
	}
    });
    socket.on('joinroom', function(join) {
	// Get the current room owner, and make it the user if it's null.
	// Then join it! :)
	socket.join(join.room); // We can use socket.io rooms! :D
    });
});
function urlify(text) {
    /*var urlRegex = /(https?:\/\/[^\s]+)/g;
      return text.replace(urlRegex, function(url) {
      return '<a href="' + url + '">' + url + '</a>';
      });*/ // Make this work with BBCode IMG
    return text;
}
console.log('info - listening');
