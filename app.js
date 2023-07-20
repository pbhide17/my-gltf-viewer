const path = require('path');
const uuid = require('uuid');

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');

const passport = require('passport');
const OnshapeStrategy = require('passport-onshape');

const config = require('./config');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'dist')));
app.use(bodyParser.json());

app.set('trust proxy', 1); // To allow to run correctly behind Heroku

app.use(session({
    secret: config.sessionSecret,
    saveUninitialized: false,
    resave: false,
    cookie: {
        name: 'app-gltf-viewer',
        sameSite: 'none',
        secure: true,
        httpOnly: true,
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new OnshapeStrategy({
        clientID: config.oauthClientId,
        clientSecret: config.oauthClientSecret,
        callbackURL: config.oauthCallbackUrl,
        authorizationURL: `${config.oauthUrl}/oauth/authorize`,
        tokenURL: `${config.oauthUrl}/oauth/token`,
        userProfileURL: `${config.oauthUrl}/api/users/sessioninfo`
    },
    (accessToken, refreshToken, profile, done) => {
        profile.accessToken = accessToken;
        profile.refreshToken = refreshToken;
        return done(null, profile);
    }
));
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.use('/oauthSignin', (req, res) => {
    const state = {
        docId: req.query.documentId,
        workId: req.query.workspaceId,
        elId: req.query.elementId
    };
    req.session.state = state;
    return passport.authenticate('onshape', { state: uuid.v4(state) })(req, res);
}, (req, res) => { /* redirected to Onshape for authentication */ });

app.use('/oauthRedirect', passport.authenticate('onshape', { failureRedirect: '/grantDenied' }), (req, res) => {
    res.redirect(`/?documentId=${req.session.state.docId}&workspaceId=${req.session.state.workId}&elementId=${req.session.state.elId}`);
});

app.get('/grantDenied', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'grantDenied.html'));
})

app.get('/', (req, res) => {
    if (!req.user) {
        return res.redirect(`/oauthSignin${req._parsedUrl.search ? req._parsedUrl.search : ""}`);
    } else {
        console.log("User: " + JSON.stringify(req.user));
        refreshAccessToken(req.user).then(() => {
            return res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
        });
    }
});

app.use('/api', require('./api'));

const refreshAccessToken = async (user) => {
    const body = 'grant_type=refresh_token&refresh_token=' + user.refreshToken + '&client_id=' + config.oauthClientId + '&client_secret=' + config.oauthClientSecret;
    console.log("In refresh token function. Body: " + body);
    let res = await fetch(config.oauthUrl + "/oauth/token?" + body, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        // body: body
    });
    let resJson = await res.json();
    let txt = await res.text();
    console.log("Refresh Token returned" + res.status + " JSON: " + JSON.stringify(resJson) + " text: " + txt);
}

module.exports = app;