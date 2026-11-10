/**
 * Translates a GUI-to-engine message from RPSI to UCI.
 *
 * @param {string} message The RPSI GUI message to translate.
 *
 * @return {string} The corresponding UCI message.
 */
const toEngine = (message) => {
	const tokens = /[^\t ]+/.exec(message);
	if (!tokens) {
		return '';
	}
	switch (tokens[0]) {
		case 'rpsi':
			return 'uci';
		case 'newgame':
			return 'ucinewgame';
		case 'position':
			const args = /^[\t ]*[^\t ]+[\t ]+(.+)/.exec(message)?.[1]?.split(/[\t ]+/);
			if (!args) {
				console.error('position command without args.');
				return '';
			}
			let in_fen = true;
			return args.map((v, i) => {
				if (in_fen) {
					switch (i) {
						case 0:
							in_fen = v === 'fen';
							// Fall through to...
						case 4:
							return v;
						case 1:
							// very dumb
							return v.split('/').reverse().join('/');
						case 2:
							return v === 'r' ? 'b' : 'w';
						case 3:
							return '- - ' + v;
						default:
					}
				}
				if (v === 'moves') {
					return v;
				}
				return v.replace('-', '');
			}).join(' ');
		case 'go':
			return message.replaceAll(' win ', ' mate ');
		case 'legalmoves':
			return '';
		default:
	}
	return message;
};

/**
 * Translates an engine-to-GUI message from UCI to RPSI.
 *
 * @param {string} message The UCI engine message to translate.
 *
 * @return {string} The corresponding RPSI message.
 */
const toGUI = (message) => {
	const tokens = /[^\t ]+/.exec(message);
	if (!tokens) {
		return '';
	}
	switch (tokens[0]) {
		case 'uciok':
			return 'rpsiok';
		case 'info': {
			// very dumb
			const string_idx = message.search(' string ');
			if (string_idx === 4) {
				return message;
			}
			let string_part;
			if (string_idx !== -1) {
				message = message.slice(0, string_idx);
				string_part = message.slice(string_idx);
			} else {
				string_part = '';
			}
			return message
				.replaceAll(' mate -', ' loss ')
				.replaceAll(' mate ', ' win ')
				.replace(/\b([a-i][1-9])([a-i][1-9])\b/g, '$1-$2')
				+ string_part;
			// Fall through to...
		}
		case 'bestmove':
			// very dumb
			return message.replace(/\b([a-i][1-9])([a-i][1-9])\b/g, '$1-$2');
		default:
	}
	return message;
}

export {toEngine, toGUI};
