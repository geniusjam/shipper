const config = process.env;

const oauth = require("./oauth");
const db = require("./DBManager");

const express = require("express");

const bodyParser = require("body-parser");

const session = require("express-session");
const { isValidObjectId, Document } = require("mongoose");
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
		req.session.lastPage = req.path;
		return res.render("index", {
			oauthLink: config.oauthLink,
			githubRepo: config.githubRepo,
			author: config.author,
		});
	}

	try {
		const user = await db.getUser(req.session.user);
		for (let i = 0; i < user.shipping.length; i++) {
			if(isValidObjectId(user.shipping[i]) && !(user.shipping[i] instanceof Document)) {
				user.shipping[i] = await db.getShipByMongoId(user.shipping[i]);
			}
			const ship = user.shipping[i];
			for (let j = 0; j < ship.people.length; j++) {
				if(isValidObjectId(ship.people[j]) && !(ship.people[j] instanceof Document)) {
					ship.people[j] = await db.getUserByMongoId(ship.people[j]);
				}
			}
		}

		res.render("main", { user });

		for (const ship of user.shipping) {
			for (const person of ship.people) {
				const fetched = await oauth.fetchUser(person.id);
				fetched.publicFlags = fetched.public_flags;
				delete fetched.public_flags;

				if (
					fetched.username !== person.username ||
					fetched.avatar !== person.avatar ||
					fetched.discriminator !== person.discriminator ||
					fetched.publicFlags !== person.publicFlags
				) {
					console.log("Updating user", person.id);
					await db.updateUser(person.id, fetched);
				}
			}
		}
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
		user.publicFlags = user.public_flags;
		delete user.public_flags;

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

		res.redirect(req.session.lastPage || "/");
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
		if (!(await db.userExists(p0))) {
			try {
				const dcUser = await oauth.fetchUser(p0);
				dcUser.publicFlags = dcUser.public_flags;
				delete dcUser.public_flags;
				const doc = await db.registerUser({
					token: "-",
					...dcUser,
				});
				people.push(doc);
			} catch (e) {
				console.warn(e);
				return res.render("createShip", {
					user,
					error: "Couldn't find a person with ID " + p0 + "!",
				});
			}
		} else {
			people.push(await db.getUser(p0));
		}

		if (!(await db.userExists(p1))) {
			try {
				const dcUser = await oauth.fetchUser(p1);
				dcUser.publicFlags = dcUser.public_flags;
				delete dcUser.public_flags;
				const doc = await db.registerUser({
					token: "-",
					...dcUser,
				});
				people.push(doc);
			} catch (e) {
				console.warn(e);
				return res.render("createShip", {
					user,
					error: "Couldn't find a person with ID " + p1 + "!",
				});
			}
		} else {
			people.push(await db.getUser(p1));
		}

		const ids = people.map((p) => p._id + "");
		const exists = await db.shipExists({
			people: { $all: ids },
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
		req.session.lastPage = req.path;

		res.render("ship", {
			user: req.session.user ? await db.getUser(req.session.user) : null,
			ship: doc,
			oauthLink: config.oauthLink,
		});

		for (const person of doc.people) {
			const fetched = await oauth.fetchUser(person.id);
			fetched.publicFlags = fetched.public_flags;
			delete fetched.public_flags;
			
			if (
				fetched.username !== person.username ||
				fetched.avatar !== person.avatar ||
				fetched.discriminator !== person.discriminator ||
				fetched.publicFlags !== person.publicFlags
			) {
				console.log("Updating user", person.id);
				await db.updateUser(person.id, fetched);
			}
		}
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

app.listen({ port: process.env.PORT || 3000 }, () =>
	console.log("I] Listening")
);
