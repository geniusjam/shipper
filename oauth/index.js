const config = process.env;

const fetch = require("node-fetch");
const FormData = require("form-data");

function getUser(token) {
	return new Promise(async (res, rej) => {
		let data = await (
			await fetch("https://discordapp.com/api/users/@me", {
				headers: {
					authorization: token,
				},
			})
		).json();
		if (data.error) return rej(data);
		if (data.retry_after)
			return setTimeout(async () => {
				try {
					res(await getUser(token));
				} catch (e) {
					rej(e);
				}
			}, data.retry_after);
		if (data.message === "401: Unauthorized") return rej(data);
		res(data);
	});
}

async function getToken(code, refresh) {
	const data = new FormData();
	data.append("client_id", config.clientId);
	data.append("client_secret", config.clientSecret);
	data.append("grant_type", refresh ? "refresh_token" : "authorization_code");
	data.append("redirect_uri", config.redirectUri);
	data.append("scope", "identify");
	data.append(refresh ? "refresh_token" : "code", code);

	const d = await (
		await fetch("https://discordapp.com/api/oauth2/token", {
			method: "POST",
			body: data,
		})
	).json();
	if (d.error) throw d;
	return {
		token: `${d.token_type} ${d.access_token}`,
		refresher: d.refresh_token,
	};
}

module.exports = {
	getToken,
	getUser,
};
