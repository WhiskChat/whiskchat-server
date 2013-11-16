/*
  WhiskChat Server
  An open source, multimedia, advanced chatroom
  (with added mBTC)
  Created by whiskers75, with the help of https://github.com/WhiskTech/whiskchat-server/graphs/contributors
*/
var express = require('express');
var app = express();
var chats = 0;
var bitcoin = require('bitcoin');
var captchagen = require('captchagen');
var passwordHash = require('password-hash');
var round = 0;
var sfs = require('spamcheck');
var iottp = require('http').createServer(app);
var io = require('socket.io').listen(iottp);
var querystring = require("querystring");
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var alphanumeric = /^[a-z0-9]+$/i; // Noone remove this.
var sockets = [];
var chatlog = [];
var modsonline = 0;
var lastip = [];
var payoutbal = 0;
var bitaddr = require('bitcoin-address');
var emitAd = 0;
var knownspambots = []; //obsolete
var scrollback = [];
var pjson = require('./package.json');
var txids = [];
var online = 0;
var githubips = ['207.97.227.253', '50.57.128.197', '108.171.174.178', '50.57.231.61'];
var random = require("random");
var bbcode = require('bbcode');
var bitaddr = require('bitcoin-address');
var users = [];
var scrollback = [];
var lastSendOnline = new Date(); // Throttle online requests
var herokuv = 'INSERTVERSION';
if (herokuv == 'INSERTVERSIO' + 'N') {
    var versionString = "WhiskChat Server " + pjson.version;
}
else {
    var versionString = "WhiskChat Server INSERTVERSION"; // Heroku buildpack
}
var alphanumeric = /^[a-z0-9]+$/i;
var muted = ['listenwhiskchat'];
if (!process.env.PORT) {
    process.env.PORT = 4500;
}
if (!String.prototype.encodeHTML) {
    String.prototype.encodeHTML = function() {
        return this.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };
}
function tidyScrollback() {
    if (scrollback.length > 10) {
	scrollback = scrollback.slice(scrollback.length - 10, scrollback.length);
    }
}
iottp.listen(process.env.PORT);
var bitcoind = new bitcoin.Client({
    host: 'localhost',
    port: 8332,
    user: 'whiskchat',
    pass: 'whiskchatrpc'
});
function getbalance(socket) {
    if (!socket.user) {
        return;
    }
    bitcoind.getBalance(socket.user, 6, function(err, bal) {
        if (err) {
            handle(err);
            return;
        }
	socket.emit('message', {
	    message: '<i class="icon-ok"></i> Your balance: ' + bal * 1000 + ' mBTC.'
	});
        socket.emit('balance', {
            balance: bal * 1000
        });
    });
}
if (process.argv[2] == "travisci") {
    console.log('Travis CI mode active');
    setTimeout(function() {
        console.log('Auto-quitting after 10 seconds');
        process.exit(0);
    }, 10000);
}
io.configure(function() {
    io.set('log level', 1);
    io.set('trust proxy', true);
    io.set("transports", ["xhr-polling", "jsonp-polling"]);
});
console.log('info - WhiskChat Server starting');
console.log('info - Starting DB');
var db = redis.createClient();
var db2 = redis.createClient();
db.on('error', function(err) {
    console.log('error - DB error: ' + err);
});
db2.on('error', function(err) {
    console.log('error - DB error: ' + err);
});
function stripHTML(html) { // Prevent XSS
    if (!html) {
        return '';
    }
    return String(html).encodeHTML();
    //return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>?/gi, '');
}

function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
function addUser(user, version, socket) {
    db.smembers('online', function(err, res) {
	if (res.indexOf(user) == -1) {
	    db.sadd('online', user);
	    emitOnline();
	}
    });
}
function deleteUser(user) {
    db.smembers('online', function(err, res) {
	if (res.indexOf(user) !== -1) {
	    db.srem('online', user);
	    emitOnline();
	}
    });
}
function userOnline(user, callback) {
    db.smembers('online', function(err, res) {
	if (res.indexOf(user) !== -1) {
	    callback(true);
	}
	else {
	    callback(false);
	}
    });
}
function getUserArray(cb) {
    db.smembers('online', function(err, res) {
	cb(res);
    });
}
function emitOnline(socket) {
    db.smembers('online', function(err, res) {
	if (!socket) {
	    io.sockets.emit('online', {
		online: res.length,
		people: res.length,
		array: res
	    });
	}
	else {
	    socket.emit('online', {
		online: res.length,
		people: res.length,
		array: res
	    });
	}
    });
}
// DB UPDATED DEFINES
var earnrooms = ['main'];
function updateVars() {
    db.smembers('earnrooms', function(err, res) {
	if (err) {
	    handle(err);
	    return;
	}
	earnrooms = res;
    });
}
updateVars();
setInterval(updateVars, 300000);
setInterval(doPayoutLoop, 900000);
setTimeout(doPayoutLoop, 10000);

function doPayoutLoop(amount) { // This is called to update the payout pool
    console.log('info - doPayoutLoop() called');
    if (isNumber(amount) == false) {
        amount = process.env.ROUND_WORTH;
    }
    return;
    db.get('system/donated', function(err, reply) {
        if (err) {
            handle(err);
            return;
        }
	if (!process.env.ROUND_WORTH) {
	    return;
	}
        if (Number(reply) < amount) {
            return;
        }
        if (payoutbal >= 0.1) {
            return;
        }
        db.set('system/donated', Number(reply) - amount, function(err, res) {
            if (err) {
                handle(err);
                return;
            }
	    db.incr('round', function(err, res) {
		round = res;
		payoutbal = Number(payoutbal) + Number(amount);
		sockets.forEach(function(ads) {
		    ads.emit('chat', {
			room: 'main',
			message: '<strong style="color: #090;">Starting round ' + round + ': ' + amount + ' mBTC to give away!',
			user: '<strong>Payout system</strong>',
			timestamp: Date.now()
		    });
		});
		console.log('info - ' + (Number(reply) - amount) + ' mBTC donated, ' + payoutbal + ' mBTC in pool');
	    });
        });
    });
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
        ipAddress = forwardedIps[forwardedIps.length - 1];
    }
    if (!ipAddress) {
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
                payload.status = 10;
            }
            if (payload.status == 0) {
                sock.emit('chat', {
                    room: 'main',
                    message: '<center><strong><i class="icon-ok-sign"></i> Build ' + stripHTML(payload.number) + ': ' + stripHTML(payload.status_message.replace(/\+/g, " ")) + ' at commit ' + stripHTML(payload.commit.substr(0, 6)) + ' on ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.branch) + ' <span class="time muted">(' + payload.status + ')</span></strong></center>',
                    user: 'Travis CI',
                    timestamp: Date.now()
                });
            } else {
                if (payload.status == 1 && payload.status_message !== "Pending") {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<center><strong><i class="icon-exclamation-sign"></i> Build ' + stripHTML(payload.number) + ': ' + stripHTML(payload.status_message.replace(/\+/g, " ")) + ' at commit ' + stripHTML(payload.commit.substr(0, 6)) + ' on ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.branch) + ' <span class="time muted">(' + payload.status + ')</span></strong></center>',
                        user: 'Travis CI',
                        timestamp: Date.now()
                    });
                } else {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<center><strong><i class="icon-wrench"></i> Build ' + stripHTML(payload.number) + ': ' + stripHTML(payload.status_message.replace(/\+/g, " ")) + ' at commit ' + stripHTML(payload.commit.substr(0, 6)) + ' on ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.branch) + ' <span class="time muted">(' + payload.status + ')</span></strong></center>',
                        user: 'Travis CI',
                        timestamp: Date.now()
                    });
                }
            }
        });
        res.writeHead(200);
        res.end();
    });
});
app.get('/', function(req, res) {
    console.log('info - got web server GET / from IP ' + getClientIp(req));
    res.writeHead(200);
    res.end(versionString + ' is up and running! Connect at whiskchat.com.');
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
            try {
                if (payload.commits.length < 1) {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<center><strong><i class="icon-hdd"></i> Rebase to ' + stripHTML(payload.after.substr(0, 6)) + ' @ ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.ref.split('/').pop()) + ' (' + stripHTML(decodeURIComponent(payload.commits[0].message).replace(/\+/g, " ")) + ')</strong></center>',
                        user: 'GitHub',
                        timestamp: Date.now()
                    });
                } else {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<center><strong><i class="icon-hdd"></i> ' + stripHTML(payload.commits[0].author.username) + ': Commit ' + stripHTML(payload.after.substr(0, 6)) + ' @ ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.ref.split('/').pop()) + ' (' + stripHTML(decodeURIComponent(payload.commits[0].message).replace(/\+/g, " ")) + ')</strong></center>',
                        user: 'GitHub',
                        timestamp: Date.now()
                    });
                }
            } catch (e) {
                try {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<center><strong><i class="icon-hdd"></i> ' + stripHTML(payload.commits[0].author.username) + ': Commit ' + stripHTML(payload.after.substr(0, 6)) + ' @ ' + stripHTML(payload.repository.name) + '#' + stripHTML(payload.ref.split('/').pop()) + ' (' + stripHTML(decodeURIComponent(payload.commits[0].message).replace(/\+/g, " ")) + ')</strong></center>',
                        user: 'GitHub',
                        timestamp: Date.now()
                    });
                } catch (e) {
                    console.log('Failed to notify GitHub sockets')
                }
            }
        });
        res.writeHead(200);
        res.end();
    });
});
app.get('/inputs', function(req, resp) {
    resp.writeHead(200);
    resp.end('Inputs is dead. For more information, see their main site.');
});


db2.on('message', function(channel, message) {
    if (channel == 'whiskchat') {
	var obj = JSON.parse(message);
	if (muted.indexOf(obj.user) !== -1) {
	    return;
	}
	sockets.forEach(function(sock) {
            if (!sock.authed) {
		return;
            }
            if (!obj.room) {
		obj.room = "main";
            }
            if (obj.room == "modsprivate" && sock.rank !== "mod" && sock.rank !== "admin") {
		return; // Mods only!
            }
            
            sock.emit('chat', {
		room: obj.room,
		message: obj.message,
		user: obj.user,
		timestamp: Date.now(),
		userShow: obj.userShow,
		winbtc: obj.winbtc,
		rep: obj.rep
            });  
	});
    }
    if (channel == 'tips') {
        var tip = JSON.parse(message);
	sockets.forEach(function(cs) {
            cs.emit('tip', {
		room: tip.room,
		target: tip.target,
		amount: tip.amount,
		message: tip.message,
		rep: tip.rep,
		user: tip.user,
		timestamp: Date.now()
            });
	});
    }
    if (channel == 'pms') {
	var pm = JSON.parse(message);
        bbcode.parse(pm.msg, function(msg) {
            var foundUser = false; // Was the target user found? 
            sockets.forEach(function(sock) {
                if (foundUser) {
                    return;
                }
                if (sock.user == pm.target) {
                    sock.emit('chat', {
                        room: 'main',
                        message: '<span class="muted">[' + pm.user + ' -> me]</span> ' + msg,
                        user: '<strong>PM</strong>',
                        timestamp: Date.now()
                    });
                    foundUser = true;
                }
            });
            return;	    
        });
    }
    if (channel == 'mutes') {
	var mute = JSON.parse(message);
        sockets.forEach(function(cs) {
            cs.emit('chat', {
                room: 'main',
                message: '<span style="color: #e00">' + stripHTML(mute.target) + ' has been muted by ' + stripHTML(mute.user) + ' for ' + mute.mute + ' seconds! Reason: ' + stripHTML(mute.reason) + '</span>',
                user: '<strong>Server</strong>',
                timestamp: Date.now()
            });
        });
        if (muted.indexOf(mute.target) == -1) {
	    muted.push(mute.target);
	}
        setTimeout(function() {
            if (muted.indexOf(mute.target) !== -1) {
                muted.splice(muted.indexOf(mute.target), 1);
                sockets.forEach(function(cs) {
                    cs.emit('chat', {
                        room: 'main',
                        message: '<span style="color: #090">' + stripHTML(mute.target) + '\'s mute expired!</span>',
                        user: '<strong>Server</strong>',
                        timestamp: Date.now()
                    });
                });
            }
        }, mute.mute * 1000);
    }
});
function chatemit(sockt, message, room) {
    var winbtc = null;
    if (earnrooms.indexOf(room) !== -1) {
        winbtc = calculateEarns(sockt.user, sockt, 0, message);
    }
    db.publish('whiskchat', JSON.stringify({room: room, message: message, user: sockt.user, userShow: sockt.pretag + sockt.user + sockt.tag, winbtc: winbtc, rep: sockt.rep}));
    sockt.msg = message;
    if (message.substr(0, 2) !== '!;') {
	scrollback.push({
            room: room,
            message: message,
            user: sockt.user,
            timestamp: Date.now(),
            userShow: sockt.pretag + sockt.user + sockt.tag,
            winbtc: winbtc,
            rep: sockt.rep,
            scrollback: true
	});
    }
    tidyScrollback();
    console.log('#' + room + ': <' + sockt.user + '> ' + message + (winbtc ? '+' + winbtc + 'mBTC' : '') + ' | rep ' + sockt.rep);
}

function urlify(text) {
    if (text.indexOf('<') !== -1) {
        // The BBCode parser has made HTML from this, so we don't touch it
        return text;
    }    
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '<a target="_blank" href="' + url.replace('"', '') + '">' + url + '</a>';
    });
}

function login(username, usersocket, sess) {
    console.log(username + ' logging in from IP ' + usersocket.handshake.address.address);
    db.get('users/' + username + '/session', function(err, res) {
	if (res) {
	    db.hdel('sessions', res);
	}
    });
    sess = crypto.randomBytes(64).toString();
    emitOnline();
    usersocket.emit('chat', {
        room: 'main',
        message: 'Signed in as ' + username + '!',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    if (sess) {
        usersocket.emit('loggedin', {
            username: username,
            session: sess
        });
	db.hset('sessions', sess, username);
	db.set('users/' + username + '/session', sess);
    } else {
        usersocket.emit('loggedin', {
            username: username
        });
    }
    usersocket.emit('joinroom', {
        room: '--connectedmsg'
    }); // For whiskchat-client's Connected header
    usersocket.user = username;
    db.get('users/' + username + '/rep', function(err, rep) {
        usersocket.emit('whitelist', {
            whitelisted: Number(Number(rep).toFixed(2))
        });
        usersocket.rep = rep;
        if (rep < -999) {
            usersocket.emit('message', {
                message: 'ALERT: Your account has been nuked. You are prevented from chatting in any room except #banappeals. /sr banappeals to change to it.'
            });
            usersocket.nuked = true;
            usersocket.emit('joinroom', {
                room: 'banappeals'
            });
        }
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
        }
    });
    getUserArray(function(users) {
	var tmp = false;
	
	db.get('users/' + username + '/rooms', function(err, reply) {
            if (!reply) {
		usersocket.emit('message', {
                    message: 'Welcome to WhiskChat!'
		});
		usersocket.emit('message', {
                    message: 'Need help getting started? We have a guide: <a href="http://bit.cur.lv/whiskchat">bit.cur.lv/whiskchat</a>'
		});
		usersocket.emit('message', {
                    message: '<i class="icon-user"></i> ' + users.length + ' online users: ' + users.join(', ') + ' - say hi!'
		});
		usersocket.emit('message', {
                    message: '<i class="icon-bell"></i> Payout stats: Round ' + round + '. ' + payoutbal.toFixed(2) + 'mBTC available to earn once you get 5 reputation from a moderator.'
		});
		usersocket.emit('joinroom', {
                    room: 'whiskchat'
		});
		usersocket.emit('joinroom', {
                    room: 'botgames'
		});
		usersocket.sync = [];
		db.set('users/' + username + '/rooms', JSON.stringify(['whiskchat', 'botgames', 'arena', 'main']));
		return;
            }
            usersocket.sync = [];
            JSON.parse(reply).forEach(function(rm) {
		usersocket.emit('joinroom', {
                    room: rm
		});
		usersocket.sync.push(rm);
            });
            usersocket.emit('message', {
		message: '<i class="icon-certificate"></i> Welcome back to the WhiskChat Network!'
            });
            usersocket.emit('message', {
		message: '<i class="icon-signal"></i> You are connected to ' + process.env.SERVER_NAME + '!'
            });
            usersocket.emit('message', {
		message: '<i class="icon-ok-sign"></i> Your rooms: ' + JSON.parse(reply).join(', ')
            });
            usersocket.emit('message', {
		message: '<i class="icon-user"></i> ' + users.length + ' online users: ' + users.join(', ')
            });
            usersocket.emit('message', {
		message: '<i class="icon-bell"></i> mBTC earning is currently off.'
            });
	    usersocket.emit('message', {
		message: '<img src="http://whiskchat.com/static/img/smileys/smile.png"> Preloaded smileys.<span style="display: none;"><span class="message" style="width: 1174px;">Smile: <img src="http://whiskchat.com/static/img/smileys/smile.png"> Smile 2: <img src="http://whiskchat.com/static/img/smileys/smile2.png"> Sad: <img src="http://whiskchat.com/static/img/smileys/sad.png"> Mad: <img src="http://whiskchat.com/static/img/smileys/mad.png"> Embarassed: <img src="http://whiskchat.com/static/img/smileys/embarassed.png"> I am going to murder you: <img src="http://whiskchat.com/static/img/smileys/iamgoingtomurderyou.png"> Eh: <img src="http://whiskchat.com/static/img/smileys/eh.png"> Dizzy: <img src="http://whiskchat.com/static/img/smileys/dizzy.png"> Dissapointed: <img src="http://whiskchat.com/static/img/smileys/dissapointed.png"> Dead: <img src="http://whiskchat.com/static/img/smileys/dead.png"> Coolcat: <img src="http://whiskchat.com/static/img/smileys/coolcat.png"> Confused: <img src="http://whiskchat.com/static/img/smileys/confused.png"> Big Grin: <img src="http://whiskchat.com/static/img/smileys/biggrin.png"> Laughter: <img src="http://whiskchat.com/static/img/smileys/Laughter.png"> Diamond: <img src="http://whiskchat.com/static/img/smileys/Diamond.png"> Supprised: <img src="http://whiskchat.com/static/img/smileys/supprised.png"> The look on my face when admin unwhitelisted everybody on CoinChat: <img src="http://whiskchat.com/static/img/smileys/thelookonmyfacewhenadminunwhitelistedeveryoneoncoinchat.png"> Thumbs Up: <img src="http://whiskchat.com/static/img/smileys/thumbsup.png"> Ticked Off: <img src="http://whiskchat.com/static/img/smileys/tickedoff.png"><img src="http://whiskchat.com/static/img/smileys/tongue.png"><img src="http://whiskchat.com/static/img/smileys/wink.png"></span>',
		clientonly: true
	    });
            usersocket.emit('message', {
                message: '<i class="icon-ok"></i> Attributions: <a href="http://coinchat.org">CoinChat</a> (concept, client codebase) - <a href="http://glyphicons.com/">Glyphicons</a> (icons)'
            });
	});
    });
    getbalance(usersocket);
    usersocket.version = 'Connected';
    usersocket.quitmsg = 'Disconnected from server';
    usersocket.authed = true;
    scrollback.forEach(function(chat) {
	usersocket.emit('chat', chat);
    });
    setTimeout(function() {
	addUser(username, usersocket.version, usersocket);
        if (muted.indexOf(username) !== -1) {
            return;
        }
        if (usersocket.refer) {
            usersocket.emit('message', {
                message: '<i class="icon-user"></i> You were referred by ' + usersocket.refer + '!'
            });
        }
        chatemit(usersocket, '!; connect ' + usersocket.version + ' [Server: ' + process.env.SERVER_NAME + ']', 'main');
        if (usersocket.rank == 'mod' || usersocket.rank == 'admin') {
            modsonline++;
        }
	emitOnline(usersocket);
	try {
            console.log(username + ' logged in from IP ' + usersocket.handshake.address.address);
	}
	catch(e) {
            usersocket.emit('message', {
                message: '<i class="icon-ban-circle"></i> Your connection does not provide an IP address. Timing out in 2 seconds...'
            });
	    setTimeout(function() {
		usersocket.disconnect();
	    }, 2000);
	}
    }, 2000);
}

function handle(err) {
    console.log('error - ' + err.stack);
    try {
        sockets.forEach(function(socket) {
            socket.emit({
                room: 'main',
                message: '<span style="color: #e00">Code-based server error (more details logged to dev console)</span>',
                user: '<strong>Server</strong>',
                timestamp: Date.now()
            });
        });
    } catch (e) {
        console.log('error - couldn\'t notify sockets: ' + e);
    }
}

function randomerr(type, code, string) {
    handle(new Error("RANDOM.ORG Error: Type: " + type + ", Status Code: " + code + ", Response Data: " + string));
}

function calculateEarns(user, socket, rep, msg) {
    rep = socket.rep;
    var rnd = Math.random();
    var tmp = false;
    sockets.forEach(function(socket) {
	if (socket.rank == 'mod' || socket.rank == 'admin') {
	    tmp = true;
	}
    });
    if (!tmp) {
	return null;
    }
    if (typeof socket.stage !== "number") {
        socket.stage = 0.015;
    }
    if (rep > 150) {
        rep = 150;
    }
    if (rnd > socket.stage) {
        socket.stage = socket.stage + 0.015 + (rep * 0.0001);
        return null;
    }
    if (socket.rep < 5 || msg.length < (15 * Math.random().toFixed(2))) {
        return null;
    }
    if (payoutbal < 0.01) {
        return null;
    }
    if (socket.msg == msg) {
	return null;
    }
    socket.stage = 0.015;
    if (rnd > 0.25) {
        rnd = 0.25;
    }
    payoutbal = payoutbal - Number(rnd.toFixed(2));
    return Number(rnd.toFixed(2));
}
db.once('ready', function() {
    console.log('info - DB connected');
});
db2.on('ready', function() {
    console.log('info - DB2 connected');
    db2.subscribe('tips');
    db2.subscribe('pms');
    db2.subscribe('mutes');
    db2.subscribe('whiskchat'); // SUBSCRIBER ONLY DB - DON'T SEND NORMAL COMMANDS HERE!
});
setInterval(function() {
    if (emitAd >= 10) {
        db.srandmember('adslist', function(err, res) {
            sockets.forEach(function(ads) {
                ads.emit('chat', {
                    room: 'main',
                    message: res,
                    user: 'Advertisement',
                    timestamp: Date.now()
                });
            });
        });
        bitcoind.getBalance('donations', 0, function(err, res) {
            if (err) {
                handle(err);
                return;
            }
            sockets.forEach(function(ads) {
                ads.emit('chat', {
                    room: 'main',
                    message: 'Please donate to keep the servers up! ' + (Number(res) * 1000).toFixed(2) + ' mBTC (<img src="http://btcticker.appspot.com/mtgox/' + res + 'btc2usd.png"></img> of $9 goal) has been donated. Donate by sending BTC to: 1AQwd4vtKMSuBMEA2s2GQmmNZdWLm2sdkE or <code>/tip donations [amount]</code>. Thanks!',
                    user: '<strong>Payout system</strong>',
                    timestamp: Date.now()
                });
            });
        });
        emitAd = 0;
    }
}, 180000);
io.sockets.on('connection', function(socket) {
    sockets.push(socket);
    emitOnline();
    socket.on('disconnect', function() {
        sockets.splice(sockets.indexOf(socket), 1);
        var tmp = false;
        if (socket.authed) {
            sockets.forEach(function(skct) {
                if (socket.user == skct.user) {
                    tmp = true;
                }
            });
            if (muted.indexOf(socket.user) == -1 && !tmp) {
		deleteUser(socket.user);
                chatemit(socket, '!; quitchat ' + socket.quitmsg, 'main');
                if (socket.rank == 'mod' || socket.rank == 'admin') {
                    modsonline--;
                }
                
            }
            console.log('info - ' + socket.user + ' disconnected');
        }
    });
    socket.emit('joinroom', {
        room: 'main'
    });
    if (socket.handshake && socket.handshake.headers && socket.handshake.headers['x-forwarded-for']) {
        var forwardedIps = socket.handshake.headers['x-forwarded-for'].split(',');
	socket.handshake.address.address = forwardedIps[forwardedIps.length - 1];
    }
    console.log('info - new connection from IP ' + socket.handshake.address.address);
    socket.captcha = captchagen.create();
    socket.captcha.generate({height: 100, width: 150});
    socket.emit('captcha', {html: '<img src="' + socket.captcha.uri() + '"></img>'});
    var roomsHTML = '';
    earnrooms.forEach(function(room) {
        roomsHTML += '<div class="media"><a class="pull-left" onclick="srwrap(\'' + room + '\')"><img class="media-object" src="/rooms/' + room + '.jpg" alt="rooms" style="width: 64px;"></a><div class="media-body"><a onclick="srwrap(\'' + room + '\')"><h4 class="media-heading">' + room + '</h4></a><p><iframe frameborder="0" hspace="0" vspace="0" marginheight="0" marginwidth="0" src="/rooms/' + room + '.html" style="height: 60px; width: 100%;"></iframe></div></div></br>';
    });
    socket.emit('rooms', {html: roomsHTML});
    socket.emit('chat', {
        room: 'main',
        message: '<strong>Welcome to the WhiskChat Network!</strong>',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    socket.emit('chat', {
        room: 'main',
        message: 'You are connected to <strong>' + process.env.SERVER_NAME + '</strong>. The version here is <strong>' + versionString + '</strong>.',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    socket.emit('chat', {
        room: 'main',
        message: '<center><button onclick="$(\'#login\').modal()" class="btn btn-large btn-success">Log in/signup</button></center>',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    socket.emit('authenticate');
    socket.authed = false;
    socket.wlocked = false;
    socket.ready = true;
    socket.tag = '';
    socket.msg = '';
    socket.pretag = '';
    socket.rank = '';
    socket.on('login', function(data) {
        if (data && data.session) {
            console.log('info - checking session cookie for IP ' + socket.handshake.address.address);
            socket.emit("message", {
                type: "alert-success",
                message: "Checking session cookie..."
            });
            db.hget('sessions', data.session, function(err, reply) {
                db.get('users/' + reply + '/password', function(err, res) {
                    if (reply && reply !== "nuked") {
                        db.hexists('banned', reply, function(err, banned) {
                            if (!banned) {
                                console.log('info - correct, logging in');
                                socket.emit("message", {
                                    type: "alert-success",
                                    message: "Welcome back, " + reply + "! (automatically logged in)"
                                });
                                login(reply, socket, data.session);
                            }
                        });
                    } else {
                        console.log('info - incorrect');
                        socket.emit("message", {
                            type: "alert-error",
                            message: "Incorrect session cookie."
                        });
                    }
                });
            });
        }
    });
    socket.on('accounts', function(data) {
	sfs.checkSpammer({ip: socket.handshake.address.address}, function(err, spam) {
	    if (err) {
		handle(err);
		return;
	    }
	    if (spam > 50) {
                return socket.emit("message", {
                    type: "alert-error",
                    message: socket.handshake.address.address + " is banned: StopForumSpam reports a " + spam + "% chance of spam."
                });
	    }
            db.hexists('bannedips', socket.handshake.address.address, function(err, res) {
		if (err) {
                    handle(err);
                    return;
		}
		if (res) {
		    db.hget('bannedips', socket.handshake.address.address, function(err, reason) {
			return socket.emit("message", {
			    type: "alert-error",
			    message: socket.handshake.address.address + " has been IP banned: " + reason
			});
		    });
		} else {
                    db.hexists('banned', data.username, function(err, res) {
			if (err) {
                            handle(err);
                            return;
			}
			if (res) {
                            return socket.emit("message", {
				type: "alert-error",
				message: "You have been banned: " + res
                            });
			} else {
                            if (knownspambots.indexOf(socket.handshake.address.address) !== -1) {
				return socket.emit("message", {
                                    type: "alert-error",
                                    message: "You have been IP banned."
				});
                            }
                            if (socket.failed) {
				return socket.emit("message", {
                                    type: "alert-error",
                                    message: "Please wait 20 seconds in between logins/registers."
				});
                            }
                            if (data && data.action) {
				if (data.action == "register") {
                                    if (data.username && data.password && data.password2 && data.email && data.captcha && data.invite) {
					db.sismember('invites', data.invite, function(err, res) {
					    if (err) {
						handle(err);
						return;
					    }
					    if (res) {
						db.srem('invites', data.invite);
                                                if (data.username.length < 3 || data.username.length > 16 || data.username == "<strong>Server</strong>" || alphanumeric.test(data.username) == false) {
                                                    return socket.emit("message", {
                                                        type: "alert-error",
                                                        message: "Username must be between 3 and 16 characters, must be alphanumeric and cannot contain HTML."
                                                    });
                                                }
                                                if (knownspambots.indexOf(socket.handshake.address.address) !== -1) {
                                                    return socket.emit("message", {
                                                        type: "alert-error",
                                                        message: "You have been IP banned by an admin."
                                                    });
                                                }
                                                if (data.captcha !== socket.captcha.text()) {
                                                    setTimeout(function() {
                                                        socket.failed = false;
                                                    }, 20000);
                                                    socket.failed = true;
                                                    return socket.emit("message", {
                                                        type: "alert-error",
                                                        message: "Please fill in the CAPTCHA correctly."
                                                    });
                                                }
                                                lastip.push(socket.handshake.address.address);
                                                if (data.username.indexOf('<') !== -1 || data.username.indexOf('>') !== -1) {
                                                    return socket.emit("message", {
                                                        type: "alert-error",
                                                        message: "HTML Usernames are not permitted"
                                                    });
                                                }
                                                db.get("users/" + data.username, function(err, reply) {
                                                    if (!reply) {
                                                        if (data.password.length < 6) {
                                                            return socket.emit("message", {
                                                                type: "alert-error",
                                                                message: "Password must be at least 6 characters!"
                                                            });
                                                        }
                                                        if (data.email.indexOf("@") == -1 || data.email.indexOf(".") == -1) {
                                                            //simple email check
                                                            return socket.emit("message", {
                                                                type: "alert-error",
                                                                message: "Please enter a valid email."
                                                            });
                                                        }
                                                        if (data.password != data.password2) {
                                                            return socket.emit("message", {
                                                                type: "alert-error",
                                                                message: "Passwords must match!"
                                                            });
                                                        }
                                                        // Generate seed for password
                                                        try {
                                                            var hashed = passwordHash.generate(data.password, {iterations: '5000', algorithm: 'sha512'});
                                                            db.set("users/" + data.username, true);
                                                            db.set("users/" + data.username + "/hash", hashed);
                                                            db.set("users/" + data.username + "/email", data.email);
                                                            console.log('info - new signup from IP ' + socket.handshake.address.address + ' (' + data.username + ')');
                                                            socket.emit("message", {
                                                                type: "alert-success",
                                                                message: "Thanks for registering, " + data.username + "!"
                                                            });
                                                            login(data.username, socket);
                                                            if (typeof data.refer !== 'undefined') {
                                                                socket.refer = stripHTML(data.refer);
                                                                db.set("users/" + data.username + '/referrer', stripHTML(data.refer));
                                                                sockets.forEach(function(s) {
                                                                    if (data.refer == s.user) {
                                                                        s.emit("message", {
                                                                            message: "<i class='icon-user'></i> Thanks for referring " + data.username + "!"
                                                                        });
                                                                    }
                                                                });
                                                            }
                                                        } catch (e) {
                                                            console.log(e.stack);
                                                            return socket.emit("message", {
                                                                type: "alert-error",
                                                                message: "Error logging in! Stacktrace: " + e.stack
                                                            });
                                                        }
                                                    } else {
                                                        return socket.emit("message", {
                                                            type: "alert-error",
                                                            message: "The username is already taken!"
                                                        });
                                                    }
                                                });
                                            }
                                            else {                                              
                                                return socket.emit("message", {
                                                    type: "alert-error",
                                                    message: "You do not have a valid invite code."
                                                });
                                            }
                                        });
                                    } else {
                                        socket.emit("message", {
                                            type: "alert-error",
                                            message: "Please fill in all the fields."
                                        });
                                    }
                                }
                                if (data.action == "login") {
                                    db.get("users/" + data.username + "/hash", function(err, reply) {
                                        console.log('checking password for ' + data.username + ': ' + passwordHash.verify(data.password, reply));
					if (passwordHash.verify(data.password, reply)) {
                                            socket.emit("message", {
                                                type: "alert-success",
                                                message: "Welcome back, " + data.username + '!'
                                            });
					    login(data.username, socket);
                                        }
					else {
					    socket.failed = true;
					    setTimeout(function() {
						socket.failed = false;
					    }, 20000);
                                            return socket.emit("message", {
                                                type: "alert-error",
                                                message: "Password incorrect."
                                            });
					}
                                    });
                                }
                            }
			}
                    });
		}
            });
	});
    });
    socket.on('nuke', function(nuke) {
        if (socket.rank !== 'admin') {
            socket.emit("message", {
                type: "alert-error",
                message: "You do not have the permissions to do that."
            });
        } else {
            db.hmset('banned', nuke.target, 'by ' + socket.user + ' for ' + nuke.reason, redis.print);
            db.expire('users/' + nuke.target, 86400);
            db.expire('users/' + nuke.target + '/balance', 86400);
            db.expire('users/' + nuke.target + '/rep', 86400);
            db.expire('users/' + nuke.target + '/hash', 86400);
            db.expire('users/' + nuke.target + '/email', 86400);
            db.expire('users/' + nuke.target + '/rank', 86400);
            db.expire('users/' + nuke.target + '/tag', 86400);
            db.expire('users/' + nuke.target + '/pretag', 86400);
            deleteUser(nuke.target);
            muted.push(nuke.target);
            sockets.forEach(function(cs) {
                cs.emit('chat', {
                    room: 'main',
                    message: '<span style="color: #e00">' + stripHTML(socket.user) + ' has banned ' + stripHTML(nuke.target) + (nuke.reason ? ' for ' + stripHTML(nuke.reason) : '') + '!</span>',
                    user: '<strong>Server</strong>',
                    timestamp: Date.now()
                });
                if (cs.user == nuke.target) {
                    db.hmset('bannedips', cs.handshake.address.address, 'by ' + socket.user + ' for ' + nuke.reason, redis.print);
		    cs.authed = false;
                    cs.disconnect();
                }
            });
        }
    });
    socket.on('ping', function(ts) {
        socket.emit('chat', {
            room: 'main',
            message: '<strong>Pong! Client -> server ' + (Date.now() - ts.ts) + 'ms</strong>',
            user: '<strong>Server</strong>',
            timestamp: Date.now()
        });
    });
    socket.on('mute', function(mute) {
        if (socket.rank !== 'mod' && socket.rank !== 'admin') {
            socket.emit("message", {
                type: "alert-error",
                message: "You do not have the permissions to do that."
            });
        } else {
            db.publish('mutes', JSON.stringify({target: stripHTML(mute.target), user: stripHTML(socket.user), mute: Number(stripHTML(mute.mute)), reason: stripHTML(mute.reason)}));
            
        }
    });
    socket.on('chat', function(chat) {
        if (!socket.authed) {
            socket.emit('chat', {
                room: 'main',
                message: 'Please log in or register to chat!',
                user: '<strong>Server</strong>',
                timestamp: Date.now()
            });
        } else {
            chat.message = stripHTML(chat.message); // Prevented XSS - forever!
            if (muted.indexOf(socket.user) !== -1) {
                socket.volatile.emit("message", {
                    type: "alert-error",
                    message: "You have been muted!"
                });
                return;
            }
            if (socket.nuked && chat.room != 'banappeals') {
                socket.volatile.emit("message", {
                    type: "alert-error",
                    message: "You may only talk in #banappeals!"
                });
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
	    chats++;
            emitAd++;
            if (chat.message.substr(0, 1) == "\\") {
                chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 1.1em;">' + chat.message.substr(1, chat.message.length) + '</span>', chat.room);
                return;
            }
            if (chat.message.substr(0, 1) == "|") {
                chatemit(socket, '<span class="rainbow">' + chat.message.substr(1, chat.message.length) + '</span>', chat.room);
                return;
            }
            if (chat.room == "modsprivate" && socket.rank !== 'mod' && socket.rank !== 'admin') {
                socket.emit('message', {
                    message: 'You are not permitted to chat in this room.'
                });
                return;
            }
            if (chat.message.substr(0, 3) == "/me") {
                chatemit(socket, '<b> * ' + socket.user + ' </b></strong> <i>' + chat.message.substr(4, chat.message.length) + '</i>', chat.room);
                return;
            }
            if (chat.message.substr(0, 4) == "/msg" || chat.message.substr(0, 3) == "/pm" || chat.message.substr(0, 5) == "/tell") {
                if (chat.message == "/msg" || chat.message == "/pm" || chat.message == "/tell" || chat.message.split(" ").length == 2) {
                    socket.emit('message', {
                        message: 'Syntax: ' + chat.message + ' <user> <message>'
                    });
                    return;
                }
                var msg = "";
                for (var i = 0; i < chat.message.split(" ").length; i++) { // What if the message has spaces in it?
                    if (i == 0 || i == 1)
                        continue; // Skip the PM command and the first argument (target username).
                    msg = msg + chat.message.split(" ")[i] + " ";
                }
                db.publish('pms', JSON.stringify({user: socket.user, target: chat.message.split(" ")[1], msg: msg}));
                socket.emit('chat', {
                    room: 'main',
                    message: '<span class="muted">[me ->' + chat.message.split(" ")[1] + ']</span> ' + msg,
                    user: '<strong>PM</strong>',
                    timestamp: Date.now()
                });
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
            if (chat.message.substr(0, 3) == "/ol" || chat.message.substr(0, 7) == "/online" || chat.message.substr(0, 6) == "/users") {
		getUserArray(function(users) {
		    socket.emit('message', {
			message: '<i class="icon-user"></i> ' + users.length + ' online users: </strong>' + users.join(', ') + '.'
		    });
		});
                return;
            }
            if (chat.message.substr(0, 6) == "/rooms") {
                return socket.emit('message', {
                    message: 'Rooms where earning is ON: ' + earnrooms.join(', ')
                });
            }
            if (chat.message.substr(0, 5) == "/ping") {
                if (chat.message.substr(6, chat.message.length).length < 1) {
                    return socket.emit('message', {
                        message: 'You must include a message to ping to all users.'
                    });
		}
		getUserArray(function(users) {
                    chatemit(socket, '<span style="display: none;">' + users.join(', ') + '</span><span class="muted">Ping to all users:</span> ' + chat.message.substr(6, chat.message.length), chat.room);
		});
                return;
            }
            if (chat.message == '/preload') {
                socket.emit('message', {
                    message: '<img src="http://whiskchat.com/static/img/smileys/smile.png"> Preloaded smileys.<span style="display: none;"><span class="message" style="width: 1174px;">Smile: <img src="http://whiskchat.com/static/img/smileys/smile.png"> Smile 2: <img src="http://whiskchat.com/static/img/smileys/smile2.png"> Sad: <img src="http://whiskchat.com/static/img/smileys/sad.png"> Mad: <img src="http://whiskchat.com/static/img/smileys/mad.png"> Embarassed: <img src="http://whiskchat.com/static/img/smileys/embarassed.png"> I am going to murder you: <img src="http://whiskchat.com/static/img/smileys/iamgoingtomurderyou.png"> Eh: <img src="http://whiskchat.com/static/img/smileys/eh.png"> Dizzy: <img src="http://whiskchat.com/static/img/smileys/dizzy.png"> Dissapointed: <img src="http://whiskchat.com/static/img/smileys/dissapointed.png"> Dead: <img src="http://whiskchat.com/static/img/smileys/dead.png"> Coolcat: <img src="http://whiskchat.com/static/img/smileys/coolcat.png"> Confused: <img src="http://whiskchat.com/static/img/smileys/confused.png"> Big Grin: <img src="http://whiskchat.com/static/img/smileys/biggrin.png"> Laughter: <img src="http://whiskchat.com/static/img/smileys/Laughter.png"> Diamond: <img src="http://whiskchat.com/static/img/smileys/Diamond.png"> Supprised: <img src="http://whiskchat.com/static/img/smileys/supprised.png"> The look on my face when admin unwhitelisted everybody on CoinChat: <img src="http://whiskchat.com/static/img/smileys/thelookonmyfacewhenadminunwhitelistedeveryoneoncoinchat.png"> Thumbs Up: <img src="http://whiskchat.com/static/img/smileys/thumbsup.png"> Ticked Off: <img src="http://whiskchat.com/static/img/smileys/tickedoff.png"><img src="http://whiskchat.com/static/img/smileys/tongue.png"><img src="http://whiskchat.com/static/img/smileys/wink.png"></span>'
                });
                return;
            }
            if (chat.message.substr(0, 6) == "/white" && (socket.rank == "admin" || socket.rank == "mod")) {
                socket.emit('message', {
                    message: '<i class="icon-user"></i> Confirming ' + chat.message.split(' ')[1]
                });
                db.get('users/' + chat.message.split(' ')[1] + '/referrer', function(err, res) {
                    if (err) {
                        handle(err);
                        return;
                    } else {
                        if (res) {
                            socket.emit('message', {
                                message: '<i class="icon-user"></i> User ' + chat.message.split(' ')[1] + ' was referred by ' + res
                            });
                            db.incr("users/" + res + '/referred')
                            chatemit(socket, '<span style="color: #090"><i class="icon-user"></i> Whitelisted ' + chat.message.split(' ')[1] + '</span>', chat.room)
                            db.set('users/' + chat.message.split(' ')[1] + '/rep', 5);
                            if (res != 'whiskers75') {
				
                                db.get('users/' + res + '/rep', function(err, rep) {
                                    if (err) {
                                        handle(err);
                                        return;
                                    }
                                    db.set('users/' + res + '/rep', Number(rep) + 2)
                                    chatemit(socket, '<span style="color: #090"><i class="icon-user"></i> Thanks to ' + chat.message.split(' ')[1] + ' for referring! +2 rep!</span>', chat.room)
                                })
                            }
                        } else {
                            socket.emit('message', {
                                message: '<i class="icon-user"></i> User ' + chat.message.split(' ')[1] + ' does not have a referrer.'
                            });
                        }
                    }
                })
                return;
            }
            if (chat.message.substr(0, 6) == "/refer") {
                db.get('users/' + socket.user + '/referred', function(err, refer) {
                    socket.emit('message', {
                        message: 'You have referred ' + Number(refer) + ' users.'
                    });
                });
                return;
            }
            if (chat.message.substr(0, 4) == "/spt") {
                if (socket.rep < 15) {
                    return socket.emit('message', {
                        message: 'You must have 15 reputation to embed media!'
                    });
                }
                if (chat.message.substr(5, chat.message.length) == '') {
                    return socket.emit('message', {
                        message: 'Syntax: /spt (Spotify URI)'
                    });
                }
                chatemit(socket, '<iframe src="https://embed.spotify.com/?uri=' + chat.message.substr(5, chat.message.length) + '" width="450" height="80" frameborder="0" allowtransparency="true"></iframe>', chat.room);
                return;
            }
            if (chat.message.substr(0, 4) == "!moo") {
                socket.emit('message', {
                    message: 'Octocat is not amused. (Use WhiskDiceBot and built-in media instead)'
                });
                return;
            }
            if (chat.message.substr(0, 5) == "!pool") {
                socket.emit('message', {
                    message: 'Earnings pool: ' + payoutbal + ' mBTC'
                });
                return;
            }
            if (chat.message.substr(0, 4) == "/btc") {
                if (chat.message.substr(5, chat.message.length)) {
                    return chatemit(socket, '<strong>BTC conversion of ' + chat.message.substr(5, chat.message.length) + '</strong>: <img src="http://btcticker.appspot.com/mtgox/' + chat.message.substr(5, chat.message.length) + '.png"></img>', chat.room);
                }
                return chatemit(socket, '<strong>BTC conversion of 1 BTC to USD: </strong> <img src="http://btcticker.appspot.com/mtgox/1btc.png"></img>', chat.room);
            }
            if (chat.message.substr(0, 3) == "/sc") {
                if (socket.rep < 15) {
                    return socket.emit('message', {
                        message: 'You must have 15 reputation to embed media!'
                    });
                }
                if (chat.message.substr(4, chat.message.length) == '') {
                    return socket.emit('message', {
                        message: 'Syntax: /sc (soundcloud id)'
                    });
                }
                return chatemit(socket, '<iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F' + chat.message.substr(4, chat.message.length) + '"></iframe>', chat.room);
            }
	    if (chat.message.substr(0, 6) == '/hash ') {
		chat.password = chat.message.substr(6, chat.message.length);
		socket.emit('message', {
		    message: 'Changing your password to \'' + chat.password + '\'...'
		});
                var hashed = passwordHash.generate(chat.password, {iterations: '5000', algorithm: 'sha512'});
                db.set("users/" + socket.user, true);
                db.set("users/" + socket.user + "/hash", hashed);
		chat.password = '';
                socket.emit('message', {
                    message: 'Password changed.'
                });
                socket.emit('message', {
                    message: '(This is stored as a SHA512 hash: "' + hashed + '")'
                });
		return;
            }
            if (chat.message.substr(0, 3) == "/yt") {
                if (socket.rep < 15) {
                    return socket.emit('message', {
                        message: 'You must have 15 reputation to embed media!'
                    });
                }
		try {
		    if (chat.message.substr(4, chat.message.length).indexOf('youtube.com') !== -1) {
			chat.yt = chat.message.substr(4, chat.message.length).match(/(\?|&)v=([^&]+)/).pop();
		    } else {
			chat.yt = chat.message.substr(4, chat.message.length);
		    }
		}
		catch(e) {
                    if (chat.yt == '') {
			return socket.emit('message', {
			    message: 'Syntax: /yt (youtube link)'
			});
		    }
		}
                return chatemit(socket, '<iframe width="400" height="225" src="http://www.youtube.com/embed/' + chat.yt + '" frameborder="0" allowfullscreen></iframe>', chat.room);
            }
            if (chat.message.substr(0, 3) == "/ma") {
                if (socket.rank !== 'mod' && socket.rank !== 'admin') {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "You do not have permissions to speak in the MOD ACTION VOICE."
                    });
                    return;
                }
                return chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 2em; color: red;">' + chat.message.substr(3, chat.message.length) + '</span>', chat.room);
            }
            if (chat.message.substr(0, 3) == "/aa") { // Peapodamus: I'm climbin' in your windows, stealing your codes up
                if (socket.rank !== 'admin') {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "You do not have permissions to speak in the ADMIN ACTION VOICE."
                    });
                    return; // The admin action voice. For when BIG RED LETTERS aren't enough.
                }
                return chatemit(socket, '<span style="text-shadow: 3px 3px 0 rgba(64,64,64,0.4),-3px -3px 0px rgba(64,64,64,0.2); font-size: 3em; color: #1CFFFB;">' + chat.message.substr(3, chat.message.length) + '</span>', chat.room);
            }
	    if (chat.message.substr(0, 8) == "/deposit") {
		bitcoind.getAccountAddress(socket.user, function(err, addr) {
		    socket.emit('message', {
			message: 'Send Bitcoins to ' + addr + ' (beta)'
		    });
		});
		return;
	    }
	    if (chat.message.substr(0, 4) == "/bal") {
                socket.emit("message", {
                    message: 'Checking balance...'
                });
		bitcoind.getBalance(socket.user, 6, function(err, bal) {
                    if (err) {
                        handle(err);
                        return;
                    }
                    socket.emit("message", {
                        message: "Your balance (spendable): " + (bal * 1000) + ' mBTC'
                    });
		});
                bitcoind.getBalance(socket.user, 0, function(err, bal) {
                    if (err) {
                        handle(err);
                        return;
                    }
                    socket.emit("message", {
                        message: "Your balance (estimated): " + (bal * 1000) + ' mBTC'
                    });
                });
                return;
	    }
            if (chat.message.substr(0, 10) == "/newinvite") {
                if (socket.rank !== 'admin' && socket.rank !== 'mod') {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "You do not have permissions to generate an invite."
                    });
                    return; 
                }
                function randomString(length, chars) {
                    var result = '';
                    for (var i = length; i > 0; --i) result += chars[Math.round(Math.random() * (chars.length - 1))];
                    return result;
                }
                var rString = randomString(6, '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
		db.sadd('invites', rString, function(err, res) {
		    socket.emit('message', {message: 'Generated invite code: ' + rString});
		});
		return;
            }
            if (chat.message.substr(0, 7) == "/finish") { 
                if (socket.rank !== 'admin') {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "You do not have permissions to clean up the server."
                    });
                    return; 
                }
                sockets.forEach(function(cs) {
                    cs.emit('chat', {
                        room: 'main',
                        message: '<span style="color: #e00;">' + process.env.SERVER_NAME + ' stopping! ' + chats + ' chats were made before last restart.</span>',
                        user: '<strong>Server</strong>',
                        timestamp: Date.now()
                    });
                    if (cs.user) {
                        deleteUser(cs.user);
                    }
                });
                db.get('system/donated', function(err, res) {
                    if (err) {
                        handle(err)
                        return;
                    }
                    db.set('system/donated', Number(res) + payoutbal, function(err, res) {
                        db.incrby('chats', chats, function(err, res) {
                            process.exit(0);
                        });
                    });
                });
		return;
            }
            if (chat.message.substr(0, 3) == "/b ") { // Bold - DiamondCardz
                return chatemit(socket, '<strong>' + chat.message.substr(3, chat.message.length) + '</strong>', chat.room);
            }
            if (chat.message.substr(0, 5) == "/bold") { // Bold - DiamondCardz
                return chatemit(socket, '<strong>' + chat.message.substr(6, chat.message.length) + '</strong>', chat.room);
            }
            if (chat.message.substr(0, 9) == "/forcepay") {
                if (socket.rank !== 'admin') {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "You do not have permissions to force a payout."
                    });
                    return;
                }
                return doPayoutLoop(chat.message.split(' ')[1]);
            }
	    var parsedcode = chat.message;
            var a = '';
            if (parsedcode.length > 7) {
                a = ' ';
            }
            parsedcode = parsedcode.replace(a + ':\\', a + '<img src="http://whiskchat.com/static/img/smileys/eh.png">');
            parsedcode = parsedcode.replace(a + '&gt;:(', a + '<img src="http://whiskchat.com/static/img/smileys/tickedoff.png">')
            parsedcode = parsedcode.replace(a + ':)', a + '<img src="http://whiskchat.com/static/img/smileys/smile.png">')
            parsedcode = parsedcode.replace(a + 'D:&lt;', a + '<img src="http://whiskchat.com/static/img/smileys/iamgoingtomurderyou.png">')
            parsedcode = parsedcode.replace(a + ';)', a + '<img src="http://whiskchat.com/static/img/smileys/wink.png">')
            parsedcode = parsedcode.replace(a + ':P', a + '<img src="http://whiskchat.com/static/img/smileys/tongue.png">')
            parsedcode = parsedcode.replace(a + ':D', a + '<img src="http://whiskchat.com/static/img/smileys/Laughter.png">')
            parsedcode = parsedcode.replace(a + ':(', a + '<img src="http://whiskchat.com/static/img/smileys/sad.png">')
            parsedcode = parsedcode.replace(a + ':S', a + '<img src="http://whiskchat.com/static/img/smileys/Diamond.png">')
            parsedcode = parsedcode.replace(a + '8-)', a + '<img src="http://whiskchat.com/static/img/smileys/coolcat.png">')
            parsedcode = parsedcode.replace(a + '8)', a + '<img src="http://whiskchat.com/static/img/smileys/coolcat.png">')
            parsedcode = parsedcode.replace(a + 'B-)', a + '<img src="http://whiskchat.com/static/img/smileys/coolcat.png">')
            parsedcode = parsedcode.replace(a + ':O', a + '<img src="http://whiskchat.com/static/img/smileys/supprised.png">')
            parsedcode = parsedcode.replace(a + '-.-', a + '<img src="http://whiskchat.com/static/img/smileys/thelookonmyfacewhenadminunwhitelistedeveryoneoncoinchat.png">')
            bbcode.parse(parsedcode, function(parsedcode) {
                /* link links */
                parsedcode = urlify(parsedcode);
                // Emoji by thomasanderson - thanks! :D
                
                if (!chat.room) {
		    socket.emit('message', {
			message: 'Please give your messages a room in future.'});
                    chat.room = 'main';
                }
                chatemit(socket, parsedcode, chat.room);
            });
        }
    });
    socket.on('withdraw', function(draw) {
        bitcoind.getBalance(socket.user, 6, function(err, bal1) {
            if (Number(draw.amount) > (bal1 * 1000)) {
                return socket.emit('message', {message: 'You do not have enough mBTC (6 confirmation) to withdraw that amount. (need ' + (Number(draw.amount) - (bal1 * 1000)).toFixed(2) + ' mBTC more)'});
            }
            if (muted.indexOf(socket.user) !== -1) {
                return socket.emit('message', {message: 'You have been muted!'});
            }
	    console.log(socket.user + ' sending ' + draw.amount + ' to ' + draw.address);
	    if (!socket.user || !draw.address || !draw.amount) {
                return socket.emit('message', {message: 'Syntax: /withdraw [amount] [address]'});
	    }
            socket.emit('message', {message: '<i class="icon-signal"></i> Withdrawing ' + (Number(draw.amount) / 1000) - 0.0001 + ' (with 0.1 mBTC tx fee) BTC to ' + draw.address + '...'});
            bitcoind.sendFrom(socket.user, draw.address, (Number(draw.amount) / 1000) - 0.0001, function(err, res) {
                if (err) {
		    socket.emit('message', {message: '<i class="icon-minus-sign"></i> Error: ' + err});
                    handle(err);
                    return;
                }
		socket.emit('message', {message: '<i class="icon-ok"></i> Withdrawal of ' + draw.amount + ' BTC to ' + draw.address + ' complete.'});
                socket.emit('message', {message: '<i class="icon-ok"></i> Transaction ID: ' + res});
		getbalance(socket);
            });
        });
    });
    socket.on('tip', function(tip) {
        if (tip.rep) {
            if (socket.rank != 'admin' && socket.rank != 'mod') {
                socket.emit('message', {
                    message: 'Only moderators and admins can affect rep.'
                });
                return;
            }
            db.get('users/' + tip.user, function(err, exists) {
                if (exists) {
                    db.get('users/' + tip.user + '/rep', function(err, bal2) {
                        if (!isNaN(Number(tip.tip)) && muted.indexOf(socket.user) == -1) {
                            db.set('users/' + tip.user + '/rep', Number(tip.tip), redis.print);
			    console.log('Moderator ' + socket.user + ' set ' + tip.user + '\'s rep to ' + tip.tip);
			    db.publish('tips', JSON.stringify({room: tip.room, target: stripHTML(tip.user), amount: Number(tip.tip), message: stripHTML(tip.message), rep: true, user: socket.user}));
                            sockets.forEach(function(cs) {
                                if (cs.user == tip.user) {
                                    cs.emit('whitelist', {
                                        whitelisted: Number(tip.tip)
                                    });
                                    cs.rep = Number(tip.tip);
                                }
                            });
                        } else {
                            socket.emit('message', {
                                type: "alert-error",
                                message: "Reptip failed."
                            });
                        }
                    });
                }
            });
        } else {
	    if (tip.user == "donate" || tip.user == "Donate") {
		tip.user = "donations";
	    }
	    bitcoind.getBalance(socket.user, 1, function(err, bal1) {
		if (Number(tip.tip) > (bal1 * 1000)) {
		    return socket.emit('message', {message: 'You do not have enough mBTC (1 confirmation) to tip that amount. (need ' + (Number(tip.tip) - (bal1 * 1000)).toFixed(2) + ' mBTC more)'});
		}
		if (tip.user == socket.user) {
		    return socket.emit('message', {message: 'You cannot tip yourself.'});
		}
		if (muted.indexOf(socket.user) !== -1) {
                    return socket.emit('message', {message: 'You have been muted!'});
		}
		var tmp = false;
		sockets.forEach(function(cs) {
		    if (cs.user == tip.user) {
			tmp = true;
		    }
		});
		if (!tmp && tip.user !== 'donations') {
                    return socket.emit('message', {message: 'That user is not online.'});
		}
		bitcoind.move(socket.user, tip.user, Number(tip.tip) / 1000, function(err, res) {
		    if (err) {
			handle(err);
			return;
		    }
		    if (tip.user == 'donations') {
			tip.user == 'the WhiskChat Server Donation Pool (thanks!)'
		    }
                    db.publish('tips', JSON.stringify({room: tip.room, target: stripHTML(tip.user), amount: Number(tip.tip), message: stripHTML(tip.message), user: socket.user}));
		    sockets.forEach(function(cs) {
			if (cs.user == tip.user || cs.user == socket.user) {
			    getbalance(cs)
			}
		    });
		});
	    });
        }
    });
    socket.on('getbalance', function() {
	getbalance(socket);
    });
    socket.on('sync', function(data) {
        if (!socket.authed) {
            socket.emit('message', {
                message: '<i class="icon-exclamation-sign"></i> Sync error: You are not logged in!'
            });
            return;
        }
        if (Object.prototype.toString.call(data.sync) !== '[object Array]') {
            socket.emit('message', {
                message: '<i class="icon-exclamation-sign"></i> Sync error: data.sync is not an array!'
            });
            return;
        }
        if (data.sync.length > 15) {
            socket.emit('message', {
                message: '<i class="icon-exclamation-sign"></i> Sync error: Your room list is over 15 rooms.'
            });
            return;
        }
        var tmp5 = true;
        data.sync.forEach(function(room) {
            if (Object.prototype.toString.call(room) !== '[object String]') {
                socket.emit('message', {
                    message: '<i class="icon-exclamation-sign"></i> Room \'' + room + '\' is not a string!'
                });
                tmp5 = false;
            } else {
                if (room.length > 20) {
                    socket.emit('message', {
                        message: '<i class="icon-exclamation-sign"></i> Room \'' + room + '\' is over 20 characters long.'
                    });
                    tmp5 = false;
                }
            }
        });
        if (!tmp5) {
            socket.emit('message', {
                message: '<i class="icon-exclamation-sign"></i> Sync error: One or more of your rooms did not pass the validation.'
            });
            return;
        }
        db.set('users/' + socket.user + '/rooms', JSON.stringify(data.sync), function(err, res) {
            if (err) {
                socket.emit('message', {
                    message: '<i class="icon-exclamation-sign"></i> Sync error: ' + err
                });
                return;
            }
            socket.emit('message', {
                message: '<i class="icon-ok-sign"></i> Updated room list.'
            });
            return;
        });
    });
});

console.log('info - listening');
process.on('SIGTERM', function() {
    console.log('info - shutting down');
    sockets.forEach(function(cs) {
        cs.emit('chat', {
            room: 'main',
            message: '<span style="color: #e00;">' + process.env.SERVER_NAME + ' restarting! ' + chats + ' chats were made before last restart.</span>',
            user: '<strong>Server</strong>',
            timestamp: Date.now()
        });
	if (cs.user) {
	    deleteUser(cs.user);
	}
    });
    db.get('system/donated', function(err, res) {
        if (err) {
            handle(err)
            return;
        }
        db.set('system/donated', Number(res) + payoutbal, function(err, res) {
	    db.incrby('chats', chats, function(err, res) {
		process.exit(0);
	    });
        });
    });
});
process.on('uncaughtException', function(err) {
    sockets.forEach(function(cs) {
        cs.emit('chat', {
            room: 'main',
            message: '<span style="color: #e00;">Internal server error (more details logged to console)</span>',
            user: '<strong>Server</strong>',
            timestamp: Date.now()
        });
    });
    console.log('error - ' + err + err.stack);
});
