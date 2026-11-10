import {toEngine, toGUI} from './rpsi-to-uci.js';

const re_mnws = /[^\t\n\f\v\r ]+/;
const re_mws = /[\t\n\f\v\r ]+/;
const re_int = /^[+-]?[0-9]+$/;

const INT_MIN = -2_148_483_648;
const INT_MAX = 2_148_483_647;

export default class Engine {
	/**
	 * Gets the name (the first token) of a command.
	 *
	 * @param {string} command The command.
	 *
	 * @return {string} The command's name.
	 *
	 * @throws {TypeError} If `command` is a null command.
	 */
	static getCommandName = (command) => {
		return command.match(re_mnws)[0];
	}
	/**
	 * Sends a command.
	 *
	 * @param command The command to send.
	 */
	static send(command) {
		Engine.#module.command(toEngine(command));
	}
	static #listeners = new Set();
	/**
	 * Sends a command and waits for a specific response.
	 *
	 * @param {string=} prompt The command to send, or `undefined` to send nothing.
	 * @param {string} response The name of the response command to wait for.
	 * @param {number=} timeout The amount of time to spend waiting, in
	 *     milliseconds. Default is 15000.
	 *
	 * @return {Promise<string>} A promise. If fulfilled, is fulfilled with the
	 *     entire response command. Will automatically reject on timeout with an
	 *     error.
	 */
	static async roundtrip(prompt, response, timeout = 15000) {
		return new Promise((resolve, reject) => {
			// setTimeout isn't async, so this is guaranteed to fire after everything else.
			const timer = setTimeout(() => {
				Engine.#listeners.delete(listener);
				reject(Error(`Timeout after ${timeout / 1000}\xA0s waiting for ${response}.`));
			}, timeout);
			const listener = (command) => {
				if (Engine.getCommandName(command) !== response) {
					return;
				}
				clearTimeout(timer);
				Engine.#listeners.delete(listener);
				resolve(command);
			};
			Engine.#listeners.add(listener);
			if (prompt) {
				Engine.send(prompt);
			}
		});
	}

	/**
	 * The maximum absolute of the evaluation for it to still be in centipawns. Any
	 * further from zero is instead a forced win.
	 */
	static EVAL_MAX = 32000;
	/**
	 * The value of a win on this turn. Each point lower adds one fullmove to the
	 * forced win clock, down to `EVAL_MAX`.
	 */
	static EVAL_MATE = 32767;
	static #eval = {
		depth: 0,
		nodes: 0,
		nps: 0,
		multipv: [],
	};
	static #thinking = 0;
	/**
	 * Querys whether the engine is currently thinking.
	 *
	 * @return {boolean} Whether the engine is thinking.
	 */
	static isThinking() {return Engine.#thinking !== 0;}
	static #started_thinking_at = 0;
	static #thinking_time = 5040;
	static #sybau_timeout;
	static #sybau_promise;
	/**
	 * Stops the engine's thinking. If the engine isn't thinking, does nothing.
	 *
	 * @throws {Error} If we time out while waiting for the engine to stop thinking.
	 */
	static async stopThinking() {
		if (Engine.#thinking === 0) {
			return;
		}
		if (Engine.#thinking !== 1) {
			await Engine.#sybau_promise;
			return;
		}
		if (Engine.#sybau_timeout !== undefined) {
			clearTimeout(Engine.#sybau_timeout);
			Engine.#sybau_timeout = undefined;
		}
		await (Engine.#sybau_promise = (async () => {
			Engine.#thinking = 2;
			try {
				await Engine.roundtrip('stop', 'bestmove');
			} catch (e) {
				Engine.#thinking = 3;
				throw e;
			}
			Engine.#thinking = 0;
		})());
	}
	/**
	 * Sets the default amount of time the engine is allowed to think.
	 *
	 * @param time The amount of time, in milliseconds.
	 */
	static setThinkingTime(time) {
		Engine.#thinking_time = time;
		if (Engine.#sybau_timeout === undefined) {
			return;
		}
		clearTimeout(Engine.#sybau_timeout);
		if (time === Infinity) {
			return;
		}
		Engine.#sybau_timeout = setTimeout(
			Engine.stopThinking,
			Math.ceil(Math.max(0, time - performance.now() + Engine.#started_thinking_at))
		);
	}
	static #startThinking(time) {
		Engine.send('go infinite');
		Engine.#thinking = 1;
		Engine.#started_thinking_at = performance.now();
		if (Engine.#thinking_time === Infinity) {
			return;
		}
		Engine.#sybau_timeout = setTimeout(
			Engine.stopThinking,
			Math.ceil(time ?? Engine.#thinking_time)
		);
	}
	/**
	 * Resumes the engine's thinking, reusing the same `fen` and `args` from the
	 * previous `sendPosition` call.
	 *
	 * @param {number=} time The amount of time to resume thinking with, or
	 *     `undefined` for the default.
	 */
	static async resumeThinking(time) {
		if (Engine.#thinking === 1) {
			return;
		}
		if (Engine.#thinking !== 0) {
			await Engine.#sybau_promise;
		}
		// Unfortunately, most engines don't pick up where they left off.
		Engine.#startThinking(time);
	}
	static #info_update_args;
	/**
	 * Sends a position to the engine and starts it thinking with the default amount
	 * of time. If the engine already is thinking, waits for it to stop first.
	 *
	 * @param {string} fen The FEN of the current position.
	 * @param {any} args An additional argument which will be saved and passed to
	 *     `onInfoUpdate` with every info update.
	 */
	static async sendPosition(fen, args) {
		await Engine.stopThinking();

		Engine.#eval.depth = Engine.#eval.nodes = Engine.#eval.nps = 0;
		Engine.#eval.multipv.forEach((v) => {v.score = 0; v.pv = null});

		Engine.send('position fen ' + fen);
		Engine.#info_update_args = args;
		Engine.#startThinking();
	}
	/**
	 * To be overriden with a custom handler which will be called every time the
	 * evaluation is updated.
	 *
	 * @param {{depth: number, nodes: number, nps: number, multipv: {score: number,
	 *     pv: number[]}=[]}} evaluation The entire evaluation object.
	 * @param {number} time_spent The time spent on the evaluation, in milliseconds.
	 * @param {number} pv_idx The index of the pv which was updated.
	 * @param {any} args The custom argument which was passed to `sendPosition`.
	 */
	static onInfoUpdate = (evaluation, time_spent, pv_idx, args) => {};
	static #infoListener(command) {
		if (Engine.getCommandName(command) !== 'info') {
			return;
		}
		const tokens = command.split(re_mws);
		const N = tokens.length;
		const info = {};
		token_loop: for (let i = 1; i < N; i++) {
			const constraint = tokens[i];
			if (info[constraint] !== undefined) {
				return;
			}
			if (++i >= N) {
				break;
			}
			switch (constraint) {
				default:
					i--;
					continue;
				case 'string':
					break token_loop;
				case 'seldepth': case 'time':
				case 'currmove': case 'hashfull':
				case 'tbhits':   case 'cpuload':
				case 'currmovenumber': case 'sbhits':
					break;
				case 'depth': case 'nodes':
				case 'nps':   case 'multipv': {
					if (!tokens[i].match(re_int)) {
						continue;
					}
					let arg = parseInt(tokens[i]);
					// We probably shouldn't just throw bad values out.
					arg = Math.max(constraint === 'nps' ? 0 : 1, Math.min(arg, INT_MAX));
					info[constraint] = arg;
					break;
				}
				case 'score': {
					let have_bound = false;
					switch (tokens[i]) {
						case 'lowerbound':
						case 'upperbound':
							i++;
							have_bound = true;
						default:
					}
					if (i + 2 > N) {
						continue;
					}
					const curr = tokens[i];
					switch (curr) {
						default:
							i--;
							continue;
						case 'cp':
						case 'win':
						case 'loss':
					}
					if (!tokens[++i].match(re_int)) {
						continue;
					}
					let score = parseInt(tokens[i]);
					if (curr === 'cp') {
						score = Math.max(-Engine.EVAL_MAX, Math.min(score, Engine.EVAL_MAX));
					} else {
						score = Math.max(Engine.EVAL_MAX + 1, Engine.EVAL_MATE - score);
					}
					if (curr === 'loss') {
						score = -score;
					}
					if (!have_bound) {
						switch (tokens[i + 1]) {
							case 'lowerbound':
							case 'upperbound':
								i++;
							default:
						}
					}
					info.score = score;
					break;
				}
				case 'currline': case 'refutation':
				case 'pv': {
					const start = i;
					while (i < N && tokens[i].match(/[a-i][1-9]-[a-i][1-9]/)) {
						i++;
					}
					i--;
					if (constraint !== 'pv') {
						break;
					}
					info.pv = [];
					for (let j = start; j <= i; j++) {
						const move = tokens[j];
						info.pv.push(
							(move.charCodeAt(0) - 0x61)
								| ((move.charCodeAt(1) - 0x31) << 4)
								| ((move.charCodeAt(3) - 0x61) << 8)
								| ((move.charCodeAt(4) - 0x31) << 12)
						);
					};
					break;
				}
			}
		}

		const line_no = info.multipv === undefined ? 0 : info.multipv - 1;
		if (Engine.#eval.multipv[line_no] === undefined) {
			Engine.#eval.multipv[line_no] = {score: 0, pv: null};
		}
		let updated = false;
		if (info.depth !== undefined && Engine.#eval.depth !== info.depth) {
			updated = true;
			Engine.#eval.depth = info.depth;
		}
		if (info.nodes !== undefined && Engine.#eval.nodes !== info.nodes) {
			updated = true;
			Engine.#eval.nodes = info.nodes;
		}
		if (info.nps !== undefined && Engine.#eval.nps !== info.nps) {
			updated = true;
			Engine.#eval.nps = info.nps;
		}
		if (info.score !== undefined && Engine.#eval.multipv[line_no].score !== info.score) {
			updated = true;
			Engine.#eval.multipv[line_no].score = info.score;
			if (info.pv !== undefined) {
				Engine.#eval.multipv[line_no].pv = info.pv;
			}
		}

		if (!updated) {
			return;
		}
		Engine.onInfoUpdate(
			Engine.#eval,
			performance.now() - Engine.#started_thinking_at,
			line_no,
			Engine.#info_update_args
		);
	}
	/**
	 * To be overriden with a custom handler which will be called when the engine
	 * finishes thinking.
	 *
	 * @param {number} depth The depth at which the search concluded.
	 */
	static onEvalFinished = (depth) => {};
	static #bestmoveListener(command) {
		if (Engine.getCommandName(command) !== 'bestmove') {
			return;
		}
		Engine.onEvalFinished(Engine.#eval.depth);
	}

	/**
	 * Parses a string of tokens ending with a lowercase word.
	 *
	 * @param {string[]} tokens The token buffer to parse from.
	 * @param {Uint32Array} and_i A buffer where the first element is the iterator.
	 *     The iterator will be updated to point to the terminating token. Assumes
	 *     the iterator doesn't start pointing past the array.
	 *
	 * @return {string} The string formed by the parsed tokens, with one space
	 *     between each word.
	 */
	static #parseString(tokens, and_i) {
		const N = tokens.length;
		let parsed = '';
		do {
			parsed += tokens[and_i[0]] + ' ';
		} while (
			++and_i[0] !== N && !(
				0x61 <= tokens[and_i[0]].charCodeAt(0) && tokens[and_i[0]].charCodeAt(0) <= 0x7A
			)
		);
		and_i[0]--;
		// There is a trailing space.
		return parsed.slice(0, parsed.length - 1);
	}
	static #options = new Map();
	static #option_listener = (command) => {
		if (Engine.getCommandName(command) !== 'option') {
			return;
		}
		const tokens = command.split(re_mws).slice(1);
		const option = {};
		for (const i_buf = new Uint32Array(1); i_buf[0] < tokens.length; i_buf[0]++) {
			const constraint = tokens[i_buf[0]];
			if ((constraint !== 'var' && option[constraint] !== undefined)
					|| ++i_buf[0] === tokens.length) {
				return;
			}
			const i = i_buf[0];
			switch (constraint) {
				default:
					return;
				case 'name':
				case 'default':
					option[constraint] = Engine.#parseString(tokens, i_buf);
					break;
				case 'type':
					switch (tokens[i]) {
						default:
							return;
						case 'check':
						case 'spin':
						case 'combo':
						case 'string':
						case 'button':
					}
					option.type = tokens[i];
					break;
				case 'min':
				case 'max': {
					if (!tokens[i].match(re_int)) {
						return;
					}
					const parsed = parseInt(tokens[i], 10);
					if (parsed < INT_MIN || parsed > INT_MAX) {
						return;
					}
					option[constraint] = parsed;
					break;
				}
				case 'var':
					if (option.var === undefined) {
						option.var = new Set();
					}
					option.var.add(Engine.#parseString(tokens, i_buf));
			}
		}
		if (option.name === undefined
				|| option.type === undefined
				|| ((option.type === 'button') !== (option.default === undefined))
				|| ((option.type === 'combo') !== (option.var !== undefined))) {
			return;
		}
		let stdopt_type;
		switch (option.name) {
			case 'Ponder':
			case 'OwnBook':
			case 'UCI_ShowCurrline':
			case 'UCI_ShowRefutations':
			case 'UCI_LimitStrength':
			case 'UCI_AnalyseMode':
				stdopt_type = 'check';
				break;
			case 'Hash':
			case 'MultiPV':
			case 'UCI_Elo':
				stdopt_type = 'spin';
				break;
			case 'UCI_Opponent':
			case 'UCI_EngineAbout':
			case 'UCI_SetPositionValue':
				stdopt_type = 'string';
		}
		if (stdopt_type !== undefined && option.type !== stdopt_type) {
			return;
		}
		switch (option.type) {
			case 'check':
				if (option.default !== 'true' && option.default !== 'false') {
					return;
				}
				break;
			case 'spin': {
				if (!option.default.match(re_int)) {
					return;
				}
				option.default = parseInt(option.default, 10);
				const min = option.min ?? INT_MIN;
				const max = option.max ?? INT_MAX;
				if (option.default < min || option.default > max) {
					return;
				}
				break;
			}
			case 'combo':
				if (!option.var.has(option.default)) {
					return;
				}
				break;
			case 'string':
				if (option.default === '<empty>') {
					option.default = '';
				}
			default:
		}
		option.value = option.default;
		Engine.#options.set(option.name, option);
	}

	/**
	 * Checks if the engine has an option.
	 *
	 * @param {string} name The name of the option. There must only be one space
	 *     between each word.
	 *
	 * @return {boolean} Whether the option exists.
	 */
	static hasOption(name) {
		return Engine.#options.has(name);
	}
	/**
	 * Gets the maximum value of a given option.
	 *
	 * @param {string} name The name of the option.
	 *
	 * @return {number=} The maximum value, or `undefined` if there is no maximum.
	 */
	static getOptionMax(name) {
		return Engine.#options.get(name)?.max;
	}
	/**
	 * Gets the minimum value of a given option.
	 *
	 * @param {string} name The name of the option.
	 *
	 * @return {number=} The minimum value, or `undefined` if there is no minimum.
	 */
	static getOptionMin(name) {
		return Engine.#options.get(name)?.min;
	}
	/**
	 * Gets the value of a given option.
	 *
	 * @param {string} name The name of the option.
	 *
	 * @return {string | number=} The value, or `undefined` if there is no value.
	 */
	static getOptionValue(name) {
		return Engine.#options.get(name)?.value;
	}
	/**
	 * Sets an option in the engine if it exists.
	 *
	 * @param {string} name The name of the option. There must only be one space
	 *     between each word.
	 * @param {string | number=} value The value to set. If the option to be set is
	 *     of type `spin` and the value is outside the valid range of values for the
	 *     option, it will be clamped to within them. Otherwise, if the value is not
	 *     a valid value for the option, the option is not set.
	 *
	 * @return {string | number=} The value the option was literally set to, or
	 *     `undefined` if the value could not be set. This may be different than the
	 *     given value in edge cases (see above).
	 *
	 * @throws {Error} If the engine is thinking.
	 */
	static setOption(name, value) {
		if (Engine.#thinking) {
			throw new Error('Cannot set option while engine is thinking.');
		}
		if (!Engine.#options.has(name)) {
			return undefined;
		}
		const option = Engine.#options.get(name);
		if (option.type === 'button') {
			value = undefined;
		} else if (option.type !== 'spin' && typeof(option) !== 'string') {
			value = String(value);
		}
		switch (option.type) {
			case 'spin':
				if (typeof(value) !== 'number') {
					value = String(value);
					if (!value.match(re_int)) {
						return undefined;
					}
					value = parseInt(value, 10);
				} else {
					value = Math.trunc(value);
				}
				const min = option.min ?? INT_MIN;
				const max = option.max ?? INT_MAX;
				value = Math.max(min, Math.min(value, max));
				break;
			case 'check':
				if (value !== 'true' && value !== 'false') {
					return undefined;
				}
				break;
			case 'combo':
				if (!option.var.has(value)) {
					return undefined;
				}
			default:
		}
		Engine.send(
			`setoption name ${name}${typeof(value) !== undefined ? ` value ${value}` : ''}`
		);
		return option.value = value;
	}

	static #module;
	/**
	 * Initializes the engine instance and waits for it to be responsive.
	 *
	 * @param {object} options
	 * @param {string | URL=} options.engine_location The location of the
	 *     engine JS file. Defaults to `../dist/rps-engine.js`.
	 * @param {string | URL=} options.nnue_location The location of the
	 *     NNUE file for the engine to use, or `undefined` to use HCE.
	 *
	 * @throws If we fail to initialize the engine.
	 */
	static async init(options = {}) {
		if (Engine.#module) {
			throw Error('Engine is already initalized.');
		}

		let location;
		if (options.engine_location instanceof URL) {
			location = options.engine_location.href;
		} else if (typeof(options.engine_location) === 'string') {
			location = options.engine_location;
		} else {
			location = '../dist/rps-engine.js';
		}
		Engine.#module = await (await import(location))?.default?.();
		if (!Engine.#module) {
			throw Error('Couldn\'t load engine module.');
		}
		Engine.#module.onEngineLine = (command) => {
			command = toGUI(command);
			command.match(re_mnws) && Engine.#listeners.forEach((v) => v(command));
		};

		Engine.#module.start();
		Engine.#listeners.add(Engine.#option_listener);
		await Engine.roundtrip('rpsi', 'rpsiok');
		Engine.#listeners.delete(Engine.#option_listener);
		await Engine.roundtrip('isready', 'readyok');

		// Hushhush needs Engine to be first.
		Engine.setOption('UCI_Variant', 'rps-v6');
		if (options.nnue_location !== undefined) {
			if (!(options.nnue_location instanceof URL)) {
				options.nnue_location = new URL(options.nnue_location);
			}
			const file = await fetch(options.nnue_location);
			if (!file.ok) {
				console.error(Error('Failed to load NNUE.'));
			} else {
				const filename = options.nnue_location.href.match(/(\/[^/#?]*)(?:[#?]|$)/)[1];
				Engine.#module.FS.writeFile(filename, new Uint8Array(await file.arrayBuffer()));
				Engine.setOption('EvalFile', filename);
				Engine.setOption('Use NNUE', 'true');
			}
		}
    	Engine.setOption('UCI_AnalyseMode', 'true');
		await Engine.roundtrip('isready', 'readyok');

		Engine.#listeners.add(Engine.#infoListener).add(Engine.#bestmoveListener);
	}
};
