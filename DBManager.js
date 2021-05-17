const config = process.env;

const crypto = require("crypto");

const mongoose = require("mongoose");
mongoose.connect(config.databaseUrl, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
	console.log("I] Connected to the database!");
});

const shipSchema = new mongoose.Schema({
	id: String,

	people: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
	shippers: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
	createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
	createdAt: Number,
});

const Ship = mongoose.model("ship", shipSchema);

const userSchema = new mongoose.Schema({
	id: String,
	username: String,
	avatar: String,
	discriminator: String,
	publicFlags: Number,
	locale: String,
	premiumType: Number,

	shipping: [{ type: mongoose.Schema.Types.ObjectId, ref: "ship" }],
	joinedAt: Number,
});

const User = mongoose.model("user", userSchema);

const users = new Map();
const ships = new Map();

const funcs = {
	updateUser: async function (id, data) {
		return new Promise((res, rej) => {
			User.findOneAndUpdate({ id }, data, (e, r) => {
				if (e) {
					return rej(e);
				}

				if(users.has(id)) {
					Object.assign(users.get(id), data);
				}

				res(r);
			});
		});
	},
	registerUser: async function (data) {
		const doc = new User({
			id: data.id,
			username: data.username,
			avatar: data.avatar,
			discriminator: data.discriminator,
			publicFlags: data.public_flags,
			locale: data.locale,
			premiumType: data.premium_type,

			shipping: [],
			joinedAt: Date.now(),
		});

		await doc.save();
		users.set(data.id, doc);
		return doc;
	},
	getUserByMongoId: function (id) {
		return new Promise((res, rej) => {
			for (const user of users.values()) {
				if (user._id === id) {
					return res(user);
				}
			}

			User.findById(id, (err, r) => {
				if (err) {
					return rej(err);
				}
				res(r);

				users.set(r.id, r);
			});
		});
	},
	getUser: function (id) {
		return new Promise((res, rej) => {
			if (users.has(id)) return res(users.get(id));
			User.findOne({ id }, (err, r) => {
				if (err) {
					return rej(err);
				}
				res(r);

				users.set(id, r);
			});
		});
	},
	userExists: async function (id) {
		return users.has(id) || (await User.exists({ id }));
	},

	ship: async function (user, ship) {
		if (user.shipping.includes(ship._id)) {
			user.shipping.splice(
				user.shipping.findIndex((s) => s.equals(ship._id)),
				1
			);

			ship.shippers.splice(
				ship.shippers.findIndex((u) => u.equals(user._id)),
				1
			);

			await ship.save();
			await user.save();
		} else {
			user.shipping.push(ship._id);
			await user.save();

			if (!ship.shippers.includes(user._id)) {
				ship.shippers.push(user._id);

				await ship.save();
			}
		}
	},
	registerShip: async function (data) {
		const id = await generateShipId();

		const doc = new Ship({
			id,
			people: data.people,
			shippers: data.shippers,
			createdBy: data.createdBy,
			createdAt: Date.now(),
		});

		await doc.save();
		ships.set(id, doc);
		return doc;
	},
	getShip: function (people) {
		return new Promise((res, rej) => {
			if (typeof people === "string") {
				if (ships.has(people)) return res(ships.get(people));
				return Ship.findOne({ id: people }, function (err, r) {
					if (err) {
						return rej(err);
					}
					res(r);

					ships.set(people, r);
				});
			}

			for (const ship of ships.values()) {
				if (
					ship.people.length === people.length &&
					people.every(
						ship.populated("people")
							? (p) => ship.people.some((q) => q._id === p)
							: (p) => ship.people.includes(p)
					)
				) {
					console.log("yo dis worked");
					return res(ship);
				}
			}

			Ship.findOne({ people: { $all: people } }, function (err, r) {
				if (err) {
					return rej(err);
				}
				res(r);

				ships.set(r.id, r);
			});
		});
	},
	getShipByMongoId: function (id) {
		return new Promise((res, rej) => {
				return Ship.findById(id, function (err, r) {
					if (err) {
						return rej(err);
					}
					res(r);

					ships.set(r.people, r);
				});
		});
	},
	shipExists: async function (id) {
		return typeof id == "object"
			? await Ship.exists(id)
			: ships.has(id) || (await Ship.exists({ id }));
	},
};

async function generateShipId() {
	const id = crypto.randomBytes(16).toString("hex");

	return (await funcs.shipExists(id)) ? generateShipId() : id;
}

module.exports = funcs;
