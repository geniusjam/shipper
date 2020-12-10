const config = process.env;

const oauth = require("./oauth");
const db = require("./DBManager");

const express = require("express");

const bodyParser = require("body-parser");

const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const sessionsStore = new MongoDBStore({
	uri: config.databaseUrl,
	collection: "session",
});
sessionsStore.on("error", console.error);

const app = express();

app.set("view engine", "ejs");

app.use("/assets/css", express.static("assets/css"));
app.use(
	session({
		secret: "ishipfocisk",
		resave: true,
		saveUninitialized: true,
		cookie: {
			/*secure: true*/
		},
		store: sessionsStore,
	})
);
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
	if (!req.session.user) {
		return res.render("index", {
			oauthLink: config.oauthLink,
		});
	}

	try {
		const user = await db.getUser(req.session.user);
		res.render("main", { user });
	} catch (e) {
		console.error(e);
		delete req.session.user;
		res.redirect("/");
	}
});

app.get("/signin", async (req, res, next) => {
	const { code } = req.query;
	if (!code) return next();

	try {
		const tokenData = await oauth.getToken(code);
		const user = await oauth.getUser(tokenData.token);

		if (!(await db.userExists(user.id))) {
			await db.registerUser({
				token: tokenData.token,
				...user,
			});
		} else {
			await db.updateUser(user.id, {
				token: tokenData.token,
				...user,
			});
		}

		req.session.user = user.id;

		res.redirect("/");
	} catch (e) {
		console.error(e);
		next();
	}
});

app.get("/ship", async (req, res) => {
	if (!req.session.user) {
		return res.redirect("/");
	}

	try {
		const user = await db.getUser(req.session.user);
		res.render("createShip", { user, error: null });
	} catch (e) {
		console.error(e);
		delete req.session.user;
		res.redirect("/");
	}
});

app.post("/ship", async (req, res) => {
	if (!req.session.user || !req.body.p0 || !req.body.p1) {
		return res.redirect("/");
	}

	const { p0, p1 } = req.body;

	try {
		const user = await db.getUser(req.session.user);

		const people = [];
		if (!(await db.userExists(p0)) || !(await db.userExists(p1))) {
			return res.render("createShip", {
				user,
				error:
					"These people aren't registered to our system yet. Share this website with them so you can ship them!",
			});
		}

		people.push(await db.getUser(p0), await db.getUser(p1));

		const ids = people.map((p) => p._id);
		const exists = await db.shipExists({
			$or: [{ people: ids }, { people: ids.reverse() }],
		});

		let doc;
		if (!exists) {
			doc = await db.registerShip({
				people: ids,
				shippers: [user._id],
				createdBy: user._id,
			});
		} else {
			doc = await db.getShip(ids);
		}

		await db.ship(user, doc);

		res.redirect("/ship/" + doc.id);
	} catch (e) {
		console.error(e);
		delete req.session.user;
		res.redirect("/");
	}
});

app.get("/ship/:id", async (req, res, next) => {
	if (!(await db.shipExists(req.params.id))) {
		return next();
	}

	const doc = await db.getShip(req.params.id);

	if (!doc.populated("people")) {
		doc.people = await Promise.all(
			doc.people.map((p) => db.getUserByMongoId(p))
		);
	}

	try {
		res.render("ship", {
			user: req.session.user ? await db.getUser(req.session.user) : null,
			ship: doc,
			oauthLink: config.oauthLink,
		});
	} catch (e) {
		console.error(e);
		delete req.session.user;
		res.redirect("/");
	}
});

app.post("/toggleShip", async (req, res, n) => {
	if (!req.session.user || !req.body.ship) {
		return res.redirect("/");
	}

	const { ship } = req.body;

	if (!(await db.shipExists(ship))) {
		return n();
	}

	const doc = await db.getShip(ship);

	try {
		const user = await db.getUser(req.session.user);
		await db.ship(user, doc);
	} catch (e) {
		console.error(e);
		delete req.session.user;
		res.redirect("/");
		return;
	}

	res.redirect("/ship/" + ship);
});

app.post("/logout", (req, res) => {
	delete req.session.user;
	res.redirect("/");
});

app.listen({ port: process.env.PORT || 3000 }, () => console.log("I] Listening"));
