/*
    WhiskChat Server
    An open source, multimedia, advanced chatroom
    (with added mBTC)
    Created by whiskers75, with the help of https://github.com/WhiskTech/whiskchat-server/graphs/contributors
*/
var express = require('express');
var app = express();
var InputsIO = require('inputs.io');
if (process.env.INPUTSAPIKEY) {
    var inputs = new InputsIO({
        APIKey: process.env.INPUTSAPIKEY,
        pin: process.env.INPUTSPIN
    });
} else {
    var inputs = new InputsIO({
        APIKey: 'none',
        pin: 'none'
    });
}
var iottp = require('http').createServer(app);
var io = require('socket.io').listen(iottp);
var querystring = require("querystring");
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var alphanumeric = /^[a-z0-9]+$/i; // Noone remove this.
var sockets = [];
var chatlog = [];
var lastip = [];
var payoutbal = 0;
var bitaddr = require('bitcoin-address');
var emitAd = true;
var knownspambots = [];
var scrollback = [];
var txids = [];
var online = 0;
var githubips = ['207.97.227.253', '50.57.128.197', '108.171.174.178', '50.57.231.61'];
var random = require("random");
var bbcode = require('bbcode');
var bitaddr = require('bitcoin-address');
var users = [];
var lastSendOnline = new Date(); // Throttle online requests
var versionString = "WhiskChat Server INSERTVERSION"; // Heroku buildpack will insert a version here
var alphanumeric = /^[a-z0-9]+$/i;
var muted = [];
if (!String.prototype.encodeHTML) {
    String.prototype.encodeHTML = function() {
        return this.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };
}
iottp.listen(process.env.PORT);
if (process.argv[2] == "travisci") {
    console.log('Travis CI mode active');
    setTimeout(function() {
        console.log('Auto-quitting after 10 seconds');
        process.exit(0);
    }, 10000);
}
io.configure(function() {
    io.set("transports", ["xhr-polling"]);
    io.set("polling duration", 2);
    io.set('log level', 1);
});
console.log('info - WhiskChat Server starting');
console.log('info - Starting DB');
if (process.env.REDISCLOUD_URL) {
    var rtg = require("url").parse(process.env.REDISCLOUD_URL);
    var db = redis.createClient(rtg.port, rtg.hostname);

    db.auth(rtg.auth.split(":")[1]);
} else {
    var db = redis.createClient();
}
db.on('error', function(err) {
    console.log('error - DB error: ' + err);
});

function stripHTML(html) { // Prevent XSS
    if (!html) {
        return '';
    }
    return html.encodeHTML();
    //return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>?/gi, '');
}

function isNumber(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
setInterval(doPayoutLoop, 900000);
setTimeout(doPayoutLoop, 10000);

function doPayoutLoop(amount) { // This is called to update the payout pool
    console.log('info - doPayoutLoop() called');
    if (isNumber(amount) == false) {
        amount = 5;
    }
    db.get('system/donated', function(err, reply) {
        if (err) {
            handle(err);
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
            payoutbal = Number(payoutbal) + Number(amount);
            sockets.forEach(function(ads) {
                ads.emit('chat', {
                    room: 'main',
                    message: '<strong>The earnings pool has been updated! There is now ' + payoutbal.toFixed(2) + ' mBTC to earn!</strong> In total, ' + (Number(reply) - amount).toFixed(2) + ' mBTC has been donated. /tip donate (amount) to donate more to the pool!',
                    user: '<strong>Payout system</strong>',
                    timestamp: Date.now()
                });
            });
            console.log('info - ' + (Number(reply) - amount) + ' mBTC donated, ' + payoutbal + ' mBTC in pool');
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
    console.log('info - Got Inputs request');
    if (getClientIp(req).substr(0, 9) !== '64.22.68.') {
        console.log('info - request was fake (' + getClientIp(req) + ')');
        resp.writeHead(401);
        resp.end('Request failed! Your IP failed to match.');
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
        } else {
            db.get('users/' + req.query.note + '/balance', function(err, reply) {
                db.set('users/' + req.query.note + '/balance', Number(reply) + (Number(req.query.amount) * 1000), function(err, res) {
                    sockets.forEach(function(so) {
                        if (so.user == req.query.note) {
                            so.emit('balance', {
                                balance: Number(reply) + Number(req.query.amount * 1000)
                            });
                            so.emit('message', {
                                message: 'You deposited ' + req.query.amount * 1000 + ' mBTC using Inputs.io'
                            });
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



function chatemit(sockt, message, room) {
    var winbtc = null;
    if (room == "main" || room == "botgames" || room == "whiskchat") { // Temp solution to prevent spammers
        winbtc = calculateEarns(sockt.user, sockt);
    }
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

        sock.emit('chat', {
            room: room,
            message: message,
            user: sockt.user,
            timestamp: Date.now(),
            userShow: sockt.pretag + sockt.user + sockt.tag,
            winbtc: winbtc,
            rep: sockt.rep
        });

    });
    console.log('#' + room + ': <' + sockt.user + '> ' + message + (winbtc ? '+' + winbtc + 'mBTC' : '') + ' | rep ' + sockt.rep);
    if (winbtc != null) {
        db.get('users/' + sockt.user + '/balance', function(err, reply) {
            if (err) {
                handle(err);
                return;
            }
            db.set('users/' + sockt.user + '/balance', Number(reply) + Number(winbtc), function(err, res) {
                if (err) {
                    handle(err);
                    return;
                }
                sockt.emit('balance', {
                    balance: Number(reply) + Number(winbtc)
                });
            });
        });
        db.get('users/' + sockt.user + '/balance', function(err, balance) {
            sockt.emit('balance', {
                balance: balance
            });
        });
        db.get('users/' + sockt.user + '/rep', function(err, rep) {
            sockt.emit('whitelist', {
                whitelisted: Number(Number(rep).toFixed(2))
            });
            sockt.rep = rep;
            if (rep < -999 && !socket.nuked) {
                usersocket.emit('message', {
                    message: 'ALERT: Your account has been nuked. You are prevented from chatting in any room except #banappeals. /sr banappeals to change to it.'
                })
                socket.nuked = true
                usersocket.emit('joinroom', {
                    room: 'banappeals'
                })
            }
        });
    }
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

    io.sockets.emit("online", {
        people: users.length,
        array: users
    });
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
    } else {
        usersocket.emit('loggedin', {
            username: username
        });
    }
    usersocket.emit('joinroom', {
        room: '--connectedmsg'
    }); // For whiskchat-client's Connected header
    usersocket.user = username;
    db.get('users/' + username + '/balance', function(err, reply) {
        usersocket.emit('balance', {
            balance: reply
        });
    });
    db.get('users/' + username + '/rep', function(err, rep) {
        usersocket.emit('whitelist', {
            whitelisted: Number(Number(rep).toFixed(2))
        });
        usersocket.rep = rep;
        if (rep < -999) {
            usersocket.emit('message', {
                message: 'ALERT: Your account has been nuked. You are prevented from chatting in any room except #banappeals. /sr banappeals to change to it.'
            })
            socket.nuked = true
            usersocket.emit('joinroom', {
                room: 'banappeals'
            })
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
    db.get('users/' + username + '/rooms', function(err, reply) {
        if (!reply) {
            usersocket.emit('message', {
                message: 'You should sync your roomlist. Subscribing you to default rooms.'
            });

            usersocket.emit('joinroom', {
                room: 'whiskchat'
            });
            usersocket.emit('joinroom', {
                room: 'botgames'
            });
            usersocket.sync = [];
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
            message: '<i class="icon-ok-sign"></i> Your rooms: ' + JSON.parse(reply).join(', ')
        });
        usersocket.emit('message', {
            message: '<i class="icon-user"></i> ' + users.length + ' online users: ' + users.join(', ')
        });
        usersocket.emit('message', {
            message: '<i class="icon-bell"></i> Payout stats: ' + payoutbal.toFixed(2) + 'mBTC in play'
        });

    });
    usersocket.version = '';
    usersocket.quitmsg = 'Disconnected from server';
    usersocket.authed = true;

    setTimeout(function() {
        if (users.indexOf(username) == -1) {
            users.push(username);
        } else {
            return;
        }
        if (muted.indexOf(username) !== -1) {
            return;
        }
        if (usersocket.refer) {
            usersocket.emit('message', {
                message: '<i class="icon-user"></i> You were referred by ' + usersocket.refer + '!'
            });
        }
        chatemit(usersocket, '!; connect ' + usersocket.version, 'main');
        console.log(username + ' logged in from IP ' + usersocket.handshake.address.address);
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

function genRoomText() {
    var tmp = {};
    users.forEach(function(sock) {
        sock.sync.forEach(function(room) {
            tmp.room += 1;
        });
    });
    return "Rooms object: " + JSON.stringify(tmp);
}

function calculateEarns(user, socket, rep) {
    rep = socket.rep;
    var rnd = Math.random();
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
    if (socket.rep < 5) { // Unwhitelisted!
        return null;
    }
    if (payoutbal < 0.01) {
        return null;
    }
    socket.stage = 0.015;
    payoutbal = payoutbal - Number(rnd.toFixed(2));
    return Number(rnd.toFixed(2));
}
db.on('ready', function() {
    console.log('info - DB connected');
});
setInterval(function() {
    if (emitAd) {
        sockets.forEach(function(ads) {
            ads.emit('chat', {
                room: 'main',
                message: '<center><iframe frameborder="0" src="https://bitads.net/gimg.php?id=308" style="overflow:hidden;width:468px;height:60px;"></iframe></center>',
                user: 'bitads',
                timestamp: Date.now()
            });
        });
        sockets.forEach(function(ads) {
            ads.emit('chat', {
                room: 'main',
                message: '<center><a href="https://bitads.net/?p=bid&id=308" target="_blank">Advertise on this adspace!</a></center>',
                user: 'bitads',
                timestamp: Date.now()
            });
        });
        emitAd = false;
    }
}, 400000);
io.sockets.on('connection', function(socket) {
    sockets.push(socket);

    if (lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000) {
        io.sockets.emit("online", {
            people: users.length,
            array: users
        });
        lastSendOnline = new Date();
    } else {
        socket.emit("online", {
            people: users.length,
            array: users
        });
    }
    socket.on('disconnect', function() {
        sockets.splice(sockets.indexOf(socket), 1);
        if (socket.authed) {
            var tmp = false;
            sockets.forEach(function(skct) {
                if (socket.user == skct.user) {
                    tmp = true;
                }
            });
            if (muted.indexOf(socket.user) == -1 && !tmp) {
                chatemit(socket, '!; quitchat ' + socket.quitmsg, 'main');
                users.splice(users.indexOf(socket.user), 1);
                io.sockets.emit("online", {
                    people: users.length,
                    array: users
                });
            }
            console.log('info - ' + socket.user + ' disconnected');
        }
    });
    socket.emit('joinroom', {
        room: 'main'
    });
    console.log('info - new connection from IP ' + socket.handshake.address.address);
    socket.emit('chat', {
        room: 'main',
        message: '<strong>Welcome to WhiskChat Server!</strong>',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    socket.emit('chat', {
        room: 'main',
        message: 'The version here is <strong>' + versionString + '</strong>. <strong>' + users.length + '</strong> users connected.',
        user: '<strong>Server</strong>',
        timestamp: Date.now()
    });
    socket.emit("online", {
        people: users.length,
        array: users
    });
    socket.authed = false;
    socket.wlocked = false;
    socket.ready = true;
    socket.tag = '';
    socket.pretag = '';
    socket.rank = '';
    socket.on('login', function(data) {
        if (data && data.session) {
            console.log('info - checking session cookie for IP ' + socket.handshake.address.address);
            socket.emit("message", {
                type: "alert-success",
                message: "Checking session cookie..."
            });
            db.get('sessions/' + data.session, function(err, reply) {
                db.get('users/' + reply + '/password', function(err, res) {
                    if (reply && reply !== "nuked") {
                        console.log('info - correct, logging in');
                        socket.emit("message", {
                            type: "alert-success",
                            message: "Welcome back, " + reply + "! (automatically logged in)"
                        });
                        login(reply, socket, data.session);
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
        if (knownspambots.indexOf(socket.handshake.address.address) !== -1) {
            return socket.emit("message", {
                type: "alert-error",
                message: "You have been IP banned."
            });
        }
        if (socket.failed) {
            return socket.emit("message", {
                type: "alert-error",
                message: "Please wait 20 seconds in between logins."
            });
        }
        if (data && data.action) {
            if (data.action == "register") {
                if (data.username && data.password && data.password2 && data.email) {
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
                                var salt = Math.floor(Math.random() * 10000000000).toString();

                                var hashed = hash.sha256(data.password, salt);

                                db.set("users/" + data.username, true);
                                db.set("users/" + data.username + "/password", hashed);
                                db.set("users/" + data.username + "/salt", salt);
                                db.set("users/" + data.username + "/email", data.email);

                                db.set("sessions/" + salt, data.username);
                                console.log('info - new signup from IP ' + socket.handshake.address.address + ' (' + data.username + ')');
                                socket.emit("message", {
                                    type: "alert-success",
                                    message: "Thanks for registering, " + data.username + "!"
                                });
                                login(data.username, socket, salt);
                                if (typeof data.refer !== 'undefined') {
                                    socket.refer = stripHTML(data.refer);
                                    db.set("users/" + data.username + '/referrer', stripHTML(data.refer));
                                    sockets.forEach(function(s) {
                                        if (data.refer == s.user) {
                                            s.emit("message", {
                                                message: "<i class='icon-user'></i> Thanks for referring " + data.username + "!"
                                            });
                                        }
                                    })
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
                } else {
                    socket.emit("message", {
                        type: "alert-error",
                        message: "Please fill in all the fields."
                    });
                }
            }
            if (data.action == "login") {
                db.get("users/" + data.username + "/password", function(err, reply) {
                    if (err || reply == "nuked" || reply == null) {
                        if (err) {
                            handle(err);
                        } else {
                            if (reply == "nuked") {
                                console.log('info - nuked user login attempt: ' + data.username);
                                socket.emit("message", {
                                    type: "alert-error",
                                    message: "You have been site-wide banned. To appeal, open an issue at https://github.com/WhiskTech/whiskchat-server/issues and tag it 'Ban Appeal'."
                                });
                            } else {
                                socket.emit("message", {
                                    type: "alert-error",
                                    message: "User does not exist."
                                });
                            }
                        }
                    } else {
                        db.get('users/' + data.username + '/salt', function(err, salt) {
                            try {
                                if (salt == null) {
                                    socket.emit("message", {
                                        type: "alert-error",
                                        message: "User does not exist."
                                    });
                                } else {
                                    if (hash.sha256(data.password, salt) == reply) {
                                        console.log('info - successful login attempt: ' + data.username);
                                        socket.emit("message", {
                                            type: "alert-success",
                                            message: "Welcome back, " + data.username + "!"
                                        });
                                        db.set("sessions/" + salt + '-new', data.username);
                                        login(data.username, socket, salt);
                                    } else {
                                        console.log('info - failed login attempt from IP ' + socket.handshake.address.address + ': ' + data.username);
                                        socket.failed = true;
                                        setTimeout(function() {
                                            socket.failed = false;
                                        }, 20000);
                                        socket.emit("message", {
                                            type: "alert-error",
                                            message: "Incorrect password."
                                        });
                                    }
                                }
                            } catch (e) {
                                console.log(e.stack);
                                return socket.emit("message", {
                                    type: "alert-error",
                                    message: "Error logging you in. Full stacktrace: " + e.stack
                                });
                            }

                        });
                    }
                });
            }
            if (data.action == 'changemail') {
                if (data.email.indexOf("@") == -1 || data.email.indexOf(".") == -1) {
                    //simple email check, as in register
                    return socket.emit("message", {
                        type: "alert-error",
                        message: "Invalid email: " + data.email + "."
                    });
                }
                if ((!data.username) || (!data.email)) {
                    // this should never happen
                    return socket.emit("message", {
                        type: "alert-error",
                        message: "Please input an email."
                    });
                }
                db.set('users/' + data.username + '/email', data.email);
                return socket.emit("message", {
                    type: "alert-success",
                    message: "Email successfully changed to " + data.email + "."
                });
            }
        }
    });
    socket.on('nuke', function(nuke) {
        if (socket.rank !== 'admin') {
            socket.emit("message", {
                type: "alert-error",
                message: "You do not have the permissions to do that."
            });
        } else {
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
                cs.emit('chat', {
                    room: 'main',
                    message: '<span style="color: #e00">' + stripHTML(socket.user) + ' has nuked ' + stripHTML(nuke.target) + ' ' + (nuke.reason ? 'for ' + stripHTML(nuke.reason) : '') + '!</span>',
                    user: '<strong>Server</strong>',
                    timestamp: Date.now()
                });
                if (cs.user == nuke.target) {
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
            if (muted.indexOf(mute.target) == -1) {
                muted.push(mute.target);
            }
            sockets.forEach(function(cs) {
                cs.emit('chat', {
                    room: 'main',
                    message: '<span style="color: #e00">' + stripHTML(mute.target) + ' has been muted by ' + stripHTML(socket.user) + ' for ' + Number(stripHTML(mute.mute)) / 60 + ' minutes! Reason: ' + stripHTML(mute.reason) + '</span>',
                    user: '<strong>Server</strong>',
                    timestamp: Date.now()
                });
            });
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
    socket.on('chat', function(chat) {
        if (!socket.authed) {
            socket.emit('chat', {
                room: 'main',
                message: 'Please log in or register to chat!',
                user: '<strong>Server</strong>',
                timestamp: Date.now()
            });
        } else {
            chat.message = stripHTML(chat.message) // Prevented XSS - forever!
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
            emitAd = true;
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
                var foundUser = false; // Was the target user found? 
                sockets.forEach(function(sock) {
                    if (foundUser) {
                        return;
                    }
                    if (sock.user == chat.message.split(" ")[1]) {
                        sock.emit('chat', {
                            room: 'main',
                            message: msg,
                            user: '<strong>PM from ' + socket.user + '</strong>',
                            timestamp: Date.now()
                        });
                        foundUser = true;
                    }
                });
                if (foundUser) {
                    socket.emit('chat', {
                        room: 'main',
                        message: msg,
                        user: '<strong>PM to ' + chat.message.split(" ")[1] + '</strong>',
                        timestamp: Date.now()
                    });
                } else {
                    socket.emit('message', {
                        message: 'PM failed: user ' + chat.message.split(" ")[1] + 'not found'
                    });
                }
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
                socket.emit('message', {
                    message: '<i class="icon-user"></i> ' + users.length + ' online users: </strong>' + users.join(', ')
                });
                return;
            }
            if (chat.message.substr(0, 5) == "/ping") {
                chatemit(socket, '<span style="display: none;">' + users.join(', ') + '</span><span class="muted">Ping to all users:</span> ' + chat.message.substr(6, chat.message.length), chat.room);
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
                if (chat.message.substr(4, chat.message.length) == '') {
                    return socket.emit('message', {
                        message: 'Syntax: /sc (soundcloud id)'
                    });
                }
                return chatemit(socket, '<iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F' + chat.message.substr(4, chat.message.length) + '"></iframe>', chat.room);
            }
            if (chat.message.substr(0, 3) == "/yt") {
                if (chat.message.substr(4, chat.message.length).indexOf('youtube.com') !== -1) {
                    chat.yt = chat.message.substr(4, chat.message.length).match(/(\?|&)v=([^&]+)/).pop();
                } else {
                    chat.yt = chat.message.substr(4, chat.message.length);
                }
                if (chat.yt == '') {
                    return socket.emit('message', {
                        message: 'Syntax: /yt (youtube link)'
                    });
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
            bbcode.parse(chat.message, function(parsedcode) {
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
        if (socket.wlocked) {
            socket.emit('message', {
                message: "A withdrawal is already in progress, or your account has been blocked by a moderator."
            });
            return;
        }
        if (bitaddr.validate(draw.address)) {
            draw.fees = 0.5;
            socket.emit('message', {
                message: 'This transaction will incur a 0.5 mBTC fee for sending using the blockchain.'
            });
        } else {
            draw.fees = 0;
        }
        socket.emit('message', {
            message: "Withdrawing " + draw.amount + "mBTC to address " + draw.address + "..."
        });

        socket.wlocked = true;
        db.get('users/' + socket.user + '/balance', function(err, bal1) {
            if (Number(draw.amount) > 0 && bal1 >= (Number(draw.amount) + draw.fees)) {
                inputs.transactions.send(draw.address, Number(draw.amount) / 1000, 'WhiskChat', function(err, tx) {
                    socket.wlocked = false;
                    if (tx != 'OK' && tx.indexOf('VOUCHER') == -1) {
                        console.log('info - ' + socket.user + ' failed to withdraw ' + draw.amount + ' to ' + draw.address + ' (' + tx + ')');
                        socket.emit('message', {
                            message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " failed! (" + tx + ")"
                        });
                        return;
                    }
                    db.set('users/' + socket.user + '/balance', Number(bal1) - (Number(draw.amount) + draw.fees), function(err, res) {
                        console.log('info - ' + socket.user + ' withdrew ' + draw.amount + ' to ' + draw.address);
                        socket.emit('message', {
                            message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " completed."
                        });
                        socket.emit('balance', {
                            balance: Number(bal1) - Number(draw.amount)
                        });
                    });
                });
            } else {
                socket.wlocked = false;
                if (bal1 < (Number(draw.amount) + draw.fees)) {
                    socket.emit('message', {
                        message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " failed! (not enough money - need " + (bal1 - draw.amount + draw.fees) + " mBTC more)"
                    });
                } else {
                    socket.emit('message', {
                        message: "Withdrawal of " + draw.amount + "mBTC to address " + draw.address + " failed! (tip more than 0)"
                    });
                }
            }
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
                            sockets.forEach(function(cs) {
                                cs.emit('tip', {
                                    room: tip.room,
                                    target: stripHTML(tip.user),
                                    amount: Number(tip.tip),
                                    message: stripHTML(tip.message),
                                    rep: true,
                                    user: socket.user,
                                    timestamp: Date.now()
                                });
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
            /*if (tip.user.split(' ').length == 2 && tip.user.split(' ')[1] == "referrer") {
                if (socket.rank != 'admin' && socket.rank != 'mod') {
                    return;
                }
                db.get('users/' + tip.user + '/referredby', function(err, res) {
                    if (res) {
                        db.incr("users/" + res + '/referred')
                        db.incr("users/" + res + '/rep')
                        sockets.forEach(function(cs) {
                            if (cs.user == res) {
                                socket.emit('message', {
                                    message: '<i class="icon-user"></i> ' + tip.user + ': referral confirmed! (+1 rep)'
                                })
                            }
                        });
                    }
                })
            } else {*/
            if (tip.user == "donate") {
                db.get('users/' + socket.user + '/balance', function(err, bal1) {
                    db.get('users/' + socket.user + '/rep', function(err, rep1) {
                        db.get('system/personal', function(err, per) {
                            db.get('system/donated', function(err, bal2) {
                                if ((Number(tip.tip) < bal1 || Number(tip.tip) == bal1) && Number(tip.tip) > 0 && tip.user != socket.user && muted.indexOf(socket.user) == -1) {
                                    db.set('users/' + socket.user + '/balance', Number(bal1) - Number(tip.tip), redis.print);
                                    db.set('system/donated', Number(bal2) + Number(tip.tip) / 2, redis.print);
                                    db.set('system/personal', Number(per) + Number(tip.tip) / 2, redis.print);
                                    db.set('users/' + socket.user + '/rep', (Number(rep1) + (Number(tip.tip) / 2)), redis.print);
                                    sockets.forEach(function(cs) {
                                        cs.emit('tip', {
                                            room: tip.room,
                                            target: 'the WhiskChat Server Payout Pool [' + (Number(bal2) + (Number(tip.tip) / 2)).toFixed(2) + ' mBTC] (+ <i class="icon-gift"></i> ' + (Number(tip.tip) / 2) + ')',
                                            amount: Number(tip.tip) / 2,
                                            message: stripHTML(tip.message),
                                            user: socket.user,
                                            timestamp: Date.now()
                                        });
                                        if (cs.user == socket.user) {
                                            socket.emit('balance', {
                                                balance: Number(bal1) - Number(tip.tip)
                                            });
                                            socket.emit('whitelist', {
                                                whitelisted: (Number(rep1) + (Number(tip.tip) / 2))
                                            });
                                            socket.rep = (Number(rep1) + (Number(tip.tip) / 2));
                                        }
                                    });
                                    sockets.forEach(function(cs) {
                                        cs.emit('tip', {
                                            room: tip.room,
                                            target: 'whiskers75\'s Funds [' + (Number(per) + (Number(tip.tip) / 2)).toFixed(2) + ' mBTC]',
                                            amount: Number(tip.tip) / 2,
                                            message: stripHTML(tip.message),
                                            user: socket.user,
                                            timestamp: Date.now()
                                        });
                                    });
                                } else {
                                    socket.emit('message', {
                                        type: "alert-error",
                                        message: "Your current balance is " + bal1 + " mBTC. Tip: " + tip.tip + "mBTC. Tip failed - you might not have enough, you may be muted or you are tipping yourself."
                                    });
                                }
                            });
                        });
                    });
                });
            } else {
                db.get('users/' + tip.user, function(err, exists) {
                    if (exists) {
                        db.get('users/' + socket.user + '/balance', function(err, bal1) {
                            db.get('users/' + tip.user + '/balance', function(err, bal2) {
                                if ((Number(tip.tip) < bal1 || Number(tip.tip) == bal1) && Number(tip.tip) > 0 && tip.user != socket.user && muted.indexOf(socket.user) == -1) {
                                    db.set('users/' + socket.user + '/balance', Number(bal1) - Number(tip.tip), redis.print);
                                    db.set('users/' + tip.user + '/balance', Number(bal2) + Number(tip.tip), redis.print);
                                    sockets.forEach(function(cs) {
                                        cs.emit('tip', {
                                            room: tip.room,
                                            target: stripHTML(tip.user),
                                            amount: Number(tip.tip),
                                            message: stripHTML(tip.message),
                                            user: socket.user,
                                            timestamp: Date.now()
                                        });
                                        if (cs.user == socket.user) {
                                            cs.emit('balance', {
                                                balance: Number(bal1) - Number(tip.tip)
                                            });
                                        }
                                        if (cs.user == tip.user) {
                                            cs.emit('balance', {
                                                balance: Number(bal2) + Number(tip.tip)
                                            });
                                        }
                                    });
                                } else {
                                    socket.emit('message', {
                                        type: "alert-error",
                                        message: "Your current balance is " + bal1 + " mBTC. Tip: " + tip.tip + "mBTC. Tip failed - you might not have enough, you may be muted or you are tipping yourself."
                                    });
                                }
                            });
                        });
                    }
                });

            }
        }
    });
    socket.on('getbalance', function() {
        if (!socket.authed) {
            return;
        }
        db.get('users/' + socket.user + '/balance', function(err, balance) {
            socket.emit('balance', {
                balance: balance
            });
        });
        db.get('users/' + socket.user + '/rep', function(err, rep) {
            socket.emit('whitelist', {
                whitelisted: Number(Number(rep).toFixed(2))
            });
            socket.rep = rep;
        });
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
            }
            if (room.length > 20) {
                socket.emit('message', {
                    message: '<i class="icon-exclamation-sign"></i> Room \'' + room + '\' is over 20 characters long.'
                });
                tmp5 = false;
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
            message: '<span style="color: #e00;">Server stopping! (most likely just rebooting)</span>',
            user: '<strong>Server</strong>',
            timestamp: Date.now()
        });
    });
    db.get('system/donated', function(err, res) {
        if (err) {
            handle(err)
            return;
        }
        db.set('system/donated', Number(res) + payoutbal, function(err, res) {
            process.exit(0);
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