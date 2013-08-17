// WhiskChat Server! :D

var express = require('express');
var app = express();
var InputsIO = require('inputs.io');
var inputs = new InputsIO({
    APIKey: process.env.INPUTSAPIKEY,
    pin: process.env.INPUTSPIN
});
var iottp = require('http').createServer(app);
var io = require('socket.io').listen(iottp);
var querystring = require("querystring");
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var alphanumeric = /^[a-z0-9]+$/i; // Noone remove this.
var sockets = [];
var lastip = [];
var bitaddr = require('bitcoin-address');
var emitAd = true;
var knownspambots = [];
var scrollback = [];
var txids = [];
var online = 0;
var githubips = ['207.97.227.253', '50.57.128.197', '108.171.174.178', '50.57.231.61'];
var random = require("random");
var bbcode = require('bbcode');
var users = [];
var lastSendOnline = new Date(); // Throttle online requests
var versionString = "WhiskChat Server INSERTVERSION"; // Heroku buildpack will insert a version here
var alphanumeric = /^[a-z0-9]+$/i;
var muted = [];

iottp.listen(process.env.PORT);
if (process.argv[2] == "travisci") {
    console.log('Travis CI mode active');
    setTimeout(function() {
	console.log('Auto-quitting after 10 seconds');
	process.exit(0);
    }, 10000);
}
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
function stripHTML(html) { // Prevent XSS
    return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>?/gi, '');
}
// Inputs.io code
function getClientIp(req) {
    var ipAddress;
    // Amazon EC2 / Heroku workaround to get real client IP
    var forwardedIpsStr = req.header('x-forwarded-for'); 
    if (forwardedIpsStr) {
        // 'x-forwarded-for' header may return multiple IP addresses in
        // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
        // the first one
        var forwardedIps = forwardedIpsStr.split(',');
        ipAddress = forwardedIps[0];
    }
    if (!ipAddress) {
        // Ensure getting client IP address still works in
        // development environment
        ipAddress = req.connection.remoteAddress;
    }
    return ipAddress;
}
app.post('/travisci', function(req, res) {
    var data = '';
    console.log('info - got Travis request from IP ' + getClientIp(req));
    req.on("data", function(chunk) {
        data += chunk;
    });
    req.on("end", function() {
        var payload = JSON.parse(decodeURIComponent(querystring.unescape(data.slice(8))));
        sockets.forEach(function(sock) {
            if (typeof payload.status != 'number') {
                payload.status = 0;
            }
            sock.emit('chat', {room: 'main', message: '<center><strong><i class="icon-wrench"></i> Build ' + stripHTML(payload.number) + ': ' + stripHTML(payload.status_message) + ' at commit ' + stripHTML(payload.commit.substr(0, 6)) + ' on ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.branch) + ' <span class="time muted">(status: ' + payload.status + ')</span></strong></center>', user: 'Travis CI', timestamp: Date.now()});
        });
        res.writeHead(200);
        res.end();
    });
});
app.post('/github', function(req, res) {
    var data = '';
    console.log('info - got GitHub request from IP ' + getClientIp(req));
    req.on("data", function(chunk) {
        data += chunk;
    });
    req.on("end", function() {
	var payload = JSON.parse(querystring.unescape(data.slice(8)));
	sockets.forEach(function(sock) {
	    if (payload.commits.length < 1) {
                sock.emit('chat', {room: 'main', message: '<center><strong><i class="icon-hdd"></i> Rebase to ' + stripHTML(payload.after.substr(0, 6)) + ' @ ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.ref.split('/').pop()) + ' (' + stripHTML(decodeURIComponent(payload.commits[0].message).replace(/\+/g, " ")) + ')</strong></center>', user: 'GitHub', timestamp: Date.now()});
	    }
	    else {
		sock.emit('chat', {room: 'main', message: '<center><strong><i class="icon-hdd"></i> ' + stripHTML(payload.commits[0].author.username) + ': Commit ' + stripHTML(payload.after.substr(0, 6)) + ' @ ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.ref.split('/').pop()) + ' (' + stripHTML(decodeURIComponent(payload.commits[0].message).replace(/\+/g, " ")) + ')</strong></center>', user: 'GitHub', timestamp: Date.now()});
	    }
	});
	res.writeHead(200);
	res.end();
    });
});
app.get('/inputs', function(req, resp) {
    console.log('info - Got Inputs request');
    if (getClientIp(req) !== "50.116.37.202") {
        console.log('info - request was fake (' + getClientIp(req) +')');
	resp.writeHead(401);
	resp.end('Y U TRY TO FAKE INPUTS CALLBACK');
	return;
    }
    console.log('info - request is authentic');
    db.get('users/' + req.query.note, function(err, user) {
	if (err) {
	    handle(err); // Wait for next callback
	    return;
	}
	if (txids.indexOf(req.query.txid) !== -1) {
	    // This is a hacky tx ;P
	    console.log('info - this tx already has been handled');
	    return;
	}
	txids.push(req.query.txid);
        if (!user || Number(req.query.amount) < 0.00001) {
	    console.log('info - returning money');
            inputs.transactions.send(req.query.from, req.query.amount, 'Error depositing. Reasons: the user does not exist (specify the username in the note field) or the deposit is too little (min deposit 0.00001 BTC)', function(err, tx) {
		if (err) {
		    handle(err); // Inputs will callback again
		    return;
		}
		console.log('tx sent: ' + tx);
	    });
	    resp.send('*OK*');
	    return;
	}
	else {
            db.get('users/' + req.query.note + '/balance', function(err, reply) {
                db.set('users/' + req.query.note + '/balance', Number(reply) + (Number(req.query.amount) * 1000), function(err, res) {
                    sockets.forEach(function(so) {
                        so.emit('chat', {room: 'main', message: '<strong>' + req.query.note + ' deposited ' + req.query.amount * 1000 + ' mBTC using Inputs.io!</strong>', user: '<strong>Server</strong>', timestamp: Date.now()});
			if (so.user == req.query.note) {
                            so.emit('balance', {balance: Number(reply) + Number(req.query.amount * 1000)});
                            so.emit('message', {message: 'You deposited ' + req.query.amount * 1000 + ' mBTC! Credited to your account.'});
			    console.log('info - deposited ' + req.query.amount + ' into ' + req.query.note + '\'s account');
			}
		    });
                    resp.send("*OK*");
                    return;
                });
            });
        }
    });
});





function chatemit(sockt, message, room, winbtc) {
    sockets.forEach(function(sock) {
	if (!sock.authed) {
	    return;
	}
	if (!room) {
	    room = "main";
	}
	if (room == "modsprivate" && sock.rank !== "mod" && sock.rank !== "admin") {
	    return; // Mods only!
	}
	if (room.indexOf(':') !== -1 && sock.user != room.split(':')[1] && sock.user != room.split(':')[0]) {
	    return;
	}
        if (room.indexOf(':') !== -1 && (sock.user == room.split(':')[1] && sock.user == room.split(':')[0])) {
            sock.emit('joinroom', {room: room});
        }
	sock.emit('chat', {room: room, message: message, user: sockt.user, timestamp: Date.now(), userShow: sockt.pretag + sockt.user + sockt.tag, winbtc: winbtc});
    });
}
function urlify(text) {
    if (text.indexOf('<') !== -1) {
        // The BBCode parser has made HTML from this, so we don't touch it
        return text;
    }
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '<a href="' + url + '" target="_blank">' + url + '</a>';
    });
}
function login(username, usersocket, sess) {
    
    io.sockets.volatile.emit("online", {people: users.length, array: users});
    if (sess) {
	usersocket.emit('loggedin', {username: username, session: sess});
    }
    else {
        usersocket.emit('loggedin', {username: username});
    }
    
    usersocket.emit('chat', {room: 'main', message: 'Signed in as ' + username + '!', user: '<strong>Server</strong>', timestamp: Date.now()});
    db.get('motd', function(err, reply) {
	if (reply) {
	    var motd = reply.split('|');
	    motd.forEach(function(line) {
                usersocket.emit('chat', {room: 'main', message: line, user: '<strong>MOTD</strong>', timestamp: Date.now()});
	    });
	}
    });
    usersocket.user = username;
    usersocket.emit('chat', {room: 'main', message: 'The latest source code is <a href="https://github.com/WhiskTech/whiskchat-server/">here</a>.', user: '<strong>MOTD</strong>', timestamp: Date.now()});
    usersocket.emit('chat', {room: 'main', message: '<iframe id="ohhai" style="" width="560" height="315" src="//www.youtube.com/embed/QvxdDDHElZo" frameborder="0" allowfullscreen=""></iframe>', user: '<strong>MOTD</strong>', timestamp: Date.now()});
    usersocket.emit('joinroom', {room: 'whiskchat'});
    usersocket.emit('joinroom', {room: 'botgames'});
    db.get('users/' + username + '/balance', function(err, reply) {
	usersocket.emit('balance', {balance: reply});
        usersocket.emit('chat', {room: 'main', message: 'Your balance is <strong style="color: #090;">' + Number(reply).toFixed(2) + ' mBTC</strong>.', user: '<strong>MOTD</strong>', timestamp: Date.now()});
        usersocket.emit('chat', {room: 'main', message: "Ad: <iframe data-aa='5513' src='//ad.a-ads.com/5513?size=468x15' scrolling='no' style='width:468px; height:15px; border:0px; padding:0;overflow:hidden' allowtransparency='true'></iframe>", user: 'Advertisement', timestamp: Date.now()});
    });
    db.get('users/' + username + '/rep', function(err, rep) {
        usersocket.emit('whitelist', {whitelisted: Number(rep)});
    });
    db.get('users/' + username + '/tag', function(err, reply) {
	if (reply) {
	    usersocket.tag = reply;
	}
    });
    db.get('users/' + username + '/pretag', function(err, reply) {
        if (reply) {
            usersocket.pretag = reply;
        }
    });
    db.get('users/' + username + '/rank', function(err, reply) {
        if (reply) {
            usersocket.rank = reply;
	    if (reply == "admin" || reply == "mod") {
		usersocket.emit('joinroom', {room: 'modsprivate'});
	    }
        }
    });
    usersocket.version = 'Unidentified client/bot';
    usersocket.quitmsg = 'Disconnected from server';
    usersocket.authed = true;
    setTimeout(function() {
        if (users.indexOf(username) == -1) {
            users.push(username);
        }
	if (muted.indexOf(username) !== -1) {
	    return;
	}
	chatemit(usersocket, '!; connect ' + usersocket.version, 'main');
        console.log(username + ' logged in from IP ' + usersocket.handshake.address.address);
    }, 2000);
}
function handle(err) {
    console.log('error - ' + err);
    try {
        sockets.forEach(function(socket) {
            socket.emit({room: 'main', message: '<span style="color: #e00">Server error: ' + err.stack.replace(/\n/g,'</br>') + '</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
	});
    }
    catch(e) {
	console.log('error - couldn\'t notify sockets: ' + e);
    }
}
function randomerr(type,code,string){
    handle(new Error("RANDOM.ORG Error: Type: "+type+", Status Code: "+code+", Response Data: "+string));
}
function calculateEarns(user, msg, callback) {
    callback(null);
}
db.on('ready', function() {
    console.log('info - DB connected');
});
setInterval(function() {
    if (emitAd) {
	sockets.forEach(function(ads) {
            ads.emit('chat', {room: 'main', message: "<iframe data-aa='5513' src='http://ad.a-ads.com/5513?size=468x15' scrolling='no' style='width:468px; height:15px; border:0px; padding:0;overflow:hidden' allowtransparency='true'></iframe>", user: 'AnonymousAds', timestamp: Date.now()});
	});
	emitAd = false;
    }
}, 300000);
setInterval(function() {
    if (emitAd) {
        sockets.forEach(function(ads) {
            ads.emit('chat', {room: 'main', message: '<center><iframe frameborder="0" src="https://bitads.net/gimg.php?id=148" style="overflow:hidden;width:468px;height:60px;"></iframe></center>', user: 'bitads', timestamp: Date.now()});
            ads.emit('chat', {room: 'main', message: '<strong><a href="https://bitads.net/?p=bid&id=148">Advertise on WhiskChat!</a></strong>', user: 'Advertising', timestamp: Date.now()});
        });
        emitAd = false;
    }
}, 400000);
io.sockets.on('connection', function(socket) {
    sockets.push(socket);
    
    if(lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000){
	io.sockets.emit("online", {people: users.length, array: users});
	lastSendOnline = new Date();
    } else {
	socket.emit("online", {people: users.length, array: users});
    }
    socket.on('disconnect', function() {
	sockets.splice(sockets.indexOf(socket), 1);
	if (socket.authed) {
	    var tmp = false;
	    if (muted.indexOf(socket.user) == -1) {
		chatemit(socket, '!; quitchat ' + socket.quitmsg, 'main');
	    }
	    sockets.forEach(function(skct) {
		if (socket.user == skct.user) {
		    skct.disconnect();
		}
	    });
            users.splice(users.indexOf(socket.user), 1);
	    io.sockets.emit("online", {people: users.length, array: users});
	}
    });
    socket.emit('joinroom', {room: 'main'});
    socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong>', user: '<strong>Server</strong>', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'The version here is <strong>' + versionString + '</strong>. <strong>' + users.length + '</strong> users connected.', user: '<strong>Server</strong>', timestamp: Date.now()});
    socket.emit("online", {people: users.length, array: users});
    socket.authed = false;
    socket.ready = true;
    socket.tag = '';
    socket.pretag = '';
    socket.rank = '';
    socket.on('login', function(data) {
        if (data && data.session) {
            socket.emit("message", {type: "alert-success", message: "Checking session cookie..."});
            db.get('sessions/' + data.session, function(err, reply) {
		db.get('users/' + reply + '/password', function(err, res) {
                    if (reply && reply !== "nuked") {
			socket.emit("message", {type: "alert-success", message: "Welcome back, " + reply + "! (automatically logged in)"});
			login(reply, socket, data.session);
                    }
                    else {
			socket.emit("message", {type: "alert-error", message: "Incorrect session cookie."});
                    }
		});
            });
        }
    });
    socket.on('accounts', function(data) {
	if(data && data.action){
	    if(data.action == "register"){
		if(data.username && data.password && data.password2 && data.email){
		    if(data.username.length < 3 || data.username.length > 16 || data.username == "<strong>Server</strong>" || alphanumeric.test(data.username) == false){
			return socket.emit("message", {type: "alert-error", message: "Username must be between 3 and 16 characters, must be alphanumeric and cannot contain HTML."});
		    }
		    if (lastip.indexOf(socket.handshake.address.address) !== -1 || knownspambots.indexOf(socket.handshake.address.address) !== -1) {
                        return socket.emit("message", {type: "alert-error", message: "You cannot register twice."});
		    }
		    lastip.push(socket.handshake.address.address);
		    if(data.username.indexOf('<') !== -1 || data.username.indexOf('>') !== -1)
		    {
			return socket.emit("message", {type: "alert-error", message: "HTML Usernames are not permitted"});
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
			    try {
				var salt = Math.floor(Math.random() * 10000000000).toString();
				
				var hashed = hash.sha256(data.password, salt);
				
				db.set("users/" + data.username, true);
				db.set("users/" + data.username + "/password", hashed);
				db.set("users/" + data.username + "/salt", salt);
				db.set("users/" + data.username + "/email", data.email);
				db.set("sessions/" + salt, data.username);
				chatemit(socket, '<span style="color: #090;"just joined WhiskChat Server for the first time!</span>', 'main');
				socket.emit("message", {type: "alert-success", message: "Thanks for registering, " + data.username + "!"});
				login(data.username, socket, salt);
			    }
			    catch(e) {
				console.log(e.stack);
                                return socket.emit("message", {type: "alert-error", message: "We couldn't hash your password. Please try again."});
			    }
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
		    if (err || reply == "nuked" || reply == null) {
			if (err) {
			    handle(err);
			}
			else {
			    if (reply == "nuked") {
				socket.emit("message", {type: "alert-error", message: "You have been banned. To appeal, open an issue at https://github.com/WhiskTech/whiskchat-server/issues and tag it 'Ban Appeal'."});
			    }
			    else {
                                socket.emit("message", {type: "alert-error", message: "User does not exist."});
			    }
			}
		    }
		    else {
			db.get('users/' + data.username + '/salt', function(err, salt) {
			    try {
				if (salt == null) {
				    socket.emit("message", {type: "alert-error", message: "User does not exist."});
				}
				else {
				    if (hash.sha256(data.password, salt) == reply) {
					socket.emit("message", {type: "alert-success", message: "Welcome back, " + data.username + "!"});
					db.set("sessions/" + salt, data.username);
					login(data.username, socket, salt);
				    }
				    else {
					socket.emit("message", {type: "alert-error", message: "Incorrect password."});
				    }
				}
                            }
                            catch(e) {
				console.log(e.stack);
                                return socket.emit("message", {type: "alert-error", message: "Error logging you in."});
                            }
			    
			});
		    }
		});
	    }
	}
    });
    socket.on('nuke', function(nuke) {
	if (socket.rank !== 'admin') {
            socket.emit("message", {type: "alert-error", message: "Nuking is admin only!"});
	}
	else {
	    db.set('users/' + nuke.target + '/password', 'nuked', redis.print);
	    db.get('users/' + nuke.target + '/salt', function(err, res) {
		if (err) {
		    handle(err);
		    return;
		}
		db.set('sessions/' + res, 'nuked', redis.print);
	    });
	    muted.push(nuke.target);
            sockets.forEach(function(cs) {
                cs.emit('chat', {room: 'main', message: '<span class="label label-important">'+ stripHTML(socket.user) + ' has nuked ' + stripHTML(nuke.target) + ' ' + (nuke.reason ? 'for ' + stripHTML(nuke.reason) : '') + '!</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
		if (cs.user == nuke.target) {
		    cs.disconnect();
		}
            });
	}
    });
    socket.on('ping', function(ts) {
        socket.emit('chat', {room: 'main', message: '<strong>Pong! Client -> server ' + (Date.now() - ts.ts) + 'ms</strong>', user: '<strong>Server</strong>', timestamp: Date.now()});
    });
    socket.on('mute', function(mute) {
	if (socket.rank !== 'mod' && socket.rank !== 'admin') {
            socket.emit("message", {type: "alert-error", message: "You are not a moderator!"});
	}
	else {
	    if (muted.indexOf(mute.target) == -1) {
		muted.push(mute.target);
	    }
	    sockets.forEach(function(cs) {
		cs.emit('chat', {room: 'main', message: '<span class="label label-important">' + stripHTML(mute.target) + ' has been muted by ' + stripHTML(socket.user) + ' for ' + stripHTML(mute.mute) + ' seconds! Reason: ' + stripHTML(mute.reason) + '</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
	    });
	    setTimeout(function() {
		if (muted.indexOf(mute.target) !== -1) {
		    muted.splice(muted.indexOf(mute.target), 1);
		    sockets.forEach(function(cs) {
			cs.emit('chat', {room: 'main', message: '<span class="label label-success">' + mute.target + '\'s mute expired!</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
		    });
		}
	    }, mute.mute * 1000);
	}
    });
    socket.on('chat', function(chat) {
	if (!socket.authed) {
            socket.emit('chat', {room: 'main', message: 'Please log in or register to chat!', user: '<strong>Server</strong>', timestamp: Date.now()});
	}
	else {
	    if (muted.indexOf(socket.user) !== -1) {
                socket.volatile.emit("message", {type: "alert-error", message: "You have been muted!"});
		return;
            }
	    if (chat.message.length < 2) {
		return;
	    }
	    if (!socket.ready) {
		return;
	    }
            socket.ready = false;
            setTimeout(function() {
                socket.ready = true;
            }, 500);
	    emitAd = true;
            if (chat.message.substr(0, 1) == "\\") {
                chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 1.1em;">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', chat.room);
		return;
	    }
            if (chat.message.substr(0, 1) == "|") {
                chatemit(socket, '<span class="rainbow">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', chat.room);
		return;
            }
	    if (chat.room == "modsprivate" && socket.rank !== 'mod' && socket.rank !== 'admin') {
		socket.emit('message', {message: 'You are not a moderator or admin. #modsprivate is restricted.'});
		return;
	    }
            if (chat.message.substr(0, 3) == "/me") {
		chatemit(socket, ' <i>' + stripHTML(chat.message.substr(4, chat.message.length)) + '</i>', chat.room);
		return;
            }
            if (chat.message.substr(0, 10) == '!; connect') {
		socket.version = chat.message.substr(11, chat.message.length);
		return;
	    }
            if (chat.message.substr(0, 11) == '!; quitchat') {
                socket.quitmsg = chat.message.substr(12, chat.message.length);
		socket.disconnect();
                return;
            }
            if (chat.message.substr(0, 3) == "/ol" || chat.message.substr(0, 7) == "/online") {
                socket.emit('message', {message: '<strong>' + users.length + ' online users: </strong>' + users.join(', ')});
                return;
            }
	    if (chat.message.substr(0, 5) == "/ping") {
                chatemit(socket, users.join(', ') + ': ' + stripHTML(chat.message.substr(6, chat.message.length)), chat.room);
                return;
	    }
	    if (chat.message.substr(0, 4) == "/spt") {
                chatemit(socket, '<iframe src="https://embed.spotify.com/?uri=' + stripHTML(chat.message.substr(5, chat.message.length)) + '" width="450" height="80" frameborder="0" allowtransparency="true"></iframe>', chat.room);
		return;
	    }
	    if (chat.message.substr(0, 4) == "!moo") {
		socket.emit('message', {message: 'Octocat is not amused.'});
                return;
	    }
            if (chat.message.substr(0, 4) == "/btc") {
                if (stripHTML(chat.message.substr(5, chat.message.length))) {
		    return chatemit(socket, '<strong>BTC conversion of ' + stripHTML(chat.message.substr(5, chat.message.length)) + '</strong>: <img src="http://btcticker.appspot.com/mtgox/' + stripHTML(chat.message.substr(5, chat.message.length)) + '.png"></img>', chat.room);
		}
                return chatemit(socket, '<strong>BTC conversion of 1 BTC to USD: </strong> <img src="http://btcticker.appspot.com/mtgox/1btc.png"></img>', chat.room);
            }
            if (chat.message.substr(0, 3) == "/sc") {
                if (stripHTML(chat.message.substr(4, chat.message.length)) == '') {
		    return socket.emit('message', {message: 'Syntax: /sc (soundcloud id)'});
		}
                return chatemit(socket, '<iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F' + stripHTML(chat.message.substr(4, chat.message.length)) + '"></iframe>', chat.room); 
            }
            if (chat.message.substr(0, 3) == "/yt") {
                if (stripHTML(chat.message.substr(4, chat.message.length)).indexOf('youtube.com') !== -1) {
                    chat.yt = stripHTML(chat.message.substr(4, chat.message.length)).match(/(\?|&)v=([^&]+)/).pop();
		}
		else {
                    chat.yt = stripHTML(chat.message.substr(4, chat.message.length));
		}
		if (chat.yt == '') {
		    return socket.emit('message', {message: 'Syntax: /yt (youtube link)'});
		}
                return chatemit(socket, '<iframe width="400" height="225" src="http://www.youtube.com/embed/' + chat.yt + '" frameborder="0" allowfullscreen></iframe>', chat.room);
            }
            if (chat.message.substr(0,3) == "/ma") {
                if (socket.rank !== 'mod' && socket.rank !== 'admin') {
                    socket.emit("message", {type: "alert-error", message: "You do not have permissions to speak in the MOD ACTION VOICE."});
		    return;
		}
		return chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 2em; color: red;">' + stripHTML(chat.message.substr(3, chat.message.length)) + '</span>', chat.room);
            }
            if (chat.message.substr(0,3) == "/aa") { // Peapodamus: I'm climbin' in your windows, stealing your codes up
                if (socket.rank !== 'admin') {
                    socket.emit("message", {type: "alert-error", message: "You do not have permissions to speak in the ADMIN ACTION VOICE."});
		    return; // The admin action voice. For when BIG RED LETTERS aren't enough.
		}
		return chatemit(socket, '<span style="text-shadow: 3px 3px 0 rgba(64,64,64,0.4),-3px -3px 0px rgba(64,64,64,0.2); font-size: 3em; color: #1CFFFB;">' + stripHTML(chat.message.substr(3, chat.message.length)) + '</span>', chat.room);
            }
            if (chat.message.substr(0, 8) == "/kickall") {
		if (socket.rank !== 'admin') {
                    socket.emit("message", {type: "alert-error", message: "You do not have permissions to use /kickall."});
                    return;
		}
                sockets.forEach(function(sock) {
		    sock.emit('message', {message: 'Kicked by ' + socket.user});
		    sock.disconnect();
		});
		return;
            }
	    bbcode.parse(stripHTML(chat.message), function(parsedcode) {
		/* link links */
                parsedcode = urlify(parsedcode);
		if (!chat.room) {
		    chat.room = 'main';
		}
		chatemit(socket, parsedcode, chat.room);
	    });
	}
    });
    socket.on('withdraw', function(draw) {
	draw.fees = 0;
	db.get('users/' + socket.user + '/balance', function(err, bal1) {
	    if (Number(draw.amount) > 0 && bal1 >= Number(draw.amount + draw.fees)) {
                inputs.transactions.send(draw.address, Number(draw.amount) / 1000, 'Withdraw from WhiskChat', function(err, tx) {
                    if (typeof tx != "object" && tx.indexOf('VOUCHER') == -1) {
                        socket.emit('message', {message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " failed! (" + tx + ")"});
                        return;
                    }
		    db.set('users/' + socket.user + '/balance', Number(bal1) - Number(draw.amount + draw.fees), function(err, res) {
			console.log('withdraw tx sent: ' + tx);
			socket.emit('message', {message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " completed."});
			socket.emit('balance', {balance: Number(bal1) - Number(draw.amount)});
		    });
                });
	    }
	    else {
		socket.emit('message', {type: "alert-error", message: "You do not have enough mBTC to do that. (there is a 0.5mBTC fee for non-Inputs transactions)"});
	    }
	});
    });
    socket.on('tip', function(tip) {
	if (tip.rep) {
            db.get('users/' + tip.user, function(err, exists) {
                if (exists) {
                    db.get('users/' + socket.user + '/balance', function(err, bal1) {
                        db.get('users/' + tip.user + '/rep', function(err, bal2) {
                            if ((Number(tip.tip) < bal1 || Number(tip.tip) == bal1) && Number(tip.tip) > 0 && tip.user != socket.user && muted.indexOf(socket.user) == -1) {
                                db.set('users/' + socket.user + '/balance', Number(bal1) - Number(tip.tip), redis.print);
                                db.set('users/' + tip.user + '/rep', Number(bal2) + Number(tip.tip), redis.print);
                                sockets.forEach(function(cs) {
                                    cs.emit('tip', {room: tip.room, target: stripHTML(tip.user) + "'s reputation", amount: Number(tip.tip), message: tip.message, user: socket.user, timestamp: Date.now()});
                                    if (cs.user == socket.user) {
                                        cs.emit('balance', {balance: Number(bal1) - Number(tip.tip)});
                                    }
                                    if (cs.user == tip.user) {
                                        cs.emit('whitelist', {whitelisted: Number(bal2) + Number(tip.tip)});
                                    }
                                });
                            }
                            else {
                                socket.emit('message', {type: "alert-error", message: "Your current balance is " + bal1 + " mBTC. Tip: " + tip.tip + "mBTC. Tip failed - you might not have enough, you may be muted or you are tipping yourself."});
                            }
                        });
                    });
                }
            });
        }
	else {
            db.get('users/' + tip.user, function(err, exists) {
		if (exists) {
                    db.get('users/' + socket.user + '/balance', function(err, bal1) {
			db.get('users/' + tip.user + '/balance', function(err, bal2) {
                            if ((Number(tip.tip) < bal1 || Number(tip.tip) == bal1) && Number(tip.tip) > 0 && tip.user != socket.user && muted.indexOf(socket.user) == -1) {
				db.set('users/' + socket.user + '/balance', Number(bal1) - Number(tip.tip), redis.print);
				db.set('users/' + tip.user + '/balance', Number(bal2) + Number(tip.tip), redis.print);
				sockets.forEach(function(cs) {
                                    cs.emit('tip', {room: tip.room, target: stripHTML(tip.user), amount: Number(tip.tip), message: tip.message, user: socket.user, timestamp: Date.now()});
                                    if (cs.user == socket.user) {
					cs.emit('balance', {balance: Number(bal1) - Number(tip.tip)});
                                    }
                                    if (cs.user == tip.user) {
					cs.emit('balance', {balance: Number(bal2) + Number(tip.tip)});
                                    }
				});
                            }
                            else {
				socket.emit('message', {type: "alert-error", message: "Your current balance is " + bal1 + " mBTC. Tip: " + tip.tip + "mBTC. Tip failed - you might not have enough, you may be muted or you are tipping yourself."});
                            }
			});
                    });
		}
	    });
	}
    });
    socket.on('getbalance', function() {
        db.get('users/' + socket.user + '/balance', function(err, balance) {
	    socket.emit('balance', {balance: balance});
	});
    });
    socket.on('joinroom', function(join) {
	// Get the current room owner, and make it the user if it's null.
	// Then join it! :)
	socket.join(join.room); // We can use socket.io rooms! :D
    });
});

console.log('info - listening');
process.on('SIGTERM', function() {
    sockets.forEach(function(cs) {
        cs.emit('chat', {room: 'main', message: '<span style="color: #e00;">Server stopping! (most likely just rebooting)</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
    });
    setTimeout(function() {
	process.exit(0);
    }, 1500);
});
process.on('uncaughtException', function(err) {
    sockets.forEach(function(cs) {
	cs.emit('chat', {room: 'main', message: '<span style="color: #e00;">Server error: ' + err.stack + '</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
    });
    console.log('error - ' + err + err.stack);
});
