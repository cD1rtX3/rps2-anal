document.getElementById('board').addEventListener(
	'contextmenu',
	(e) => e.preventDefault()
);

const ROCK = 1;
const PAPER = 2;
const SCISSORS = 3;
const BLUE = 0;
const RED = 4;

// 65 is 'A', and 49 is '1'.
const getSquareName = (x, y) => String.fromCharCode(65 + x, 49 + y);
const getNamedSquare = (name) => ({
	x: name.charCodeAt(0) - 65,
	y: name.charCodeAt(1) - 49,
});

const getStartpos = () => JSON.parse(`[
	[0, 0, 0, 0, 0, 0, 0, 0, 0],
	[0, 0, 0, 1, 2, 0, 0, 0, 0],
	[0, 0, 1, 2, 3, 0, 0, 0, 0],
	[0, 1, 2, 3, 0, 0, 0, 0, 0],
	[0, 2, 3, 0, 0, 0, 7, 6, 0],
	[0, 0, 0, 0, 0, 7, 6, 5, 0],
	[0, 0, 0, 0, 7, 6, 5, 0, 0],
	[0, 0, 0, 0, 6, 5, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 0, 0, 0]
]`);
/** The current pieces on the board, by row (*y*), then by column (*x*). */
let board = getStartpos();
let red_to_move = false;
let current_fullmove = 1;
let starting_fullmove = 1;
let rule50 = 0;
/**
 * A map from numeric variation IDs to arrays of moves. The first element of
 * each array is an object in the form `{depth, from, from_idx}`, where `depth`
 * is the node's depth, `from` is the ID of the parent (or `undefined` for the
 * root), and `from_idx` is the ply number of the starting position if the node
 * is the root or the location in the parent this variation is mentioned if it
 * isn't.
 *
 * Each subsequent element of the arrays is an object in the form `{px, py, tx,
 * ty, captured, rule50_before, variations}`, where `px` and `py` are the coörds
 * of the start square, `tx` and `ty` are the coörds of the target square,
 * `captured` is the piece which was captured or zero if no piece was captured,
 * `rule50_before` is the 100-move rule value before this move, and
 * `variations`, if non-null…
 */
const history_tree = new Map(JSON.parse(
	'[[0, [{"from_idx": 0, "depth": 0}]]]'
));
/** A reference to the variation we are in. */
let current_variation = history_tree.get(0);
/** The ID of the variation we are in. */
let current_variation_id = 0;
/** The index of the previous move in the current variation. */
let current_history_idx = 0;

const id_buffer = new ArrayBuffer(8);
const id_uint64 = new BigUint64Array(id_buffer);
const id_float64 = new Float64Array(id_buffer);
/**
 * Counts up the floats, starting at 5e−324 and hitting every float on the way
 * to positive infinity. There are a little over 9.2 quintillion values in that
 * range, which should be enough.
 */
const getNextID = () => {
	id_uint64[0] += 1n;
	return id_float64[0];
};

const piece_letters = ['', 'R', 'P', 'S', undefined, 'r', 'p', 's'];
const getFen = () => {
	let board_string = '';
	for (let y = 9; y-- > 0;) {
		let empties = 0;
		for (let x = 0; x < 9; x++) {
			const piece = board[y][x];
			if (!piece) {
				empties++;
				continue;
			}
			if (empties) {
				board_string += String(empties);
				empties = 0;
			}
			board_string += piece_letters[piece];
		}
		if (empties) {
			board_string += String(empties);
		}
		if (y > 0) {
			board_string += '/';
		}
	}
	// screw you henhen
	return board_string
		+ ` ${red_to_move ? 'r' : 'b'} ${rule50} ${current_fullmove}`;
};

const setSide = () => {
	const to_move = red_to_move ? 'red ' : 'blue ';
	const opponent = red_to_move ? 'blue ' : 'red ';
	document.getElementsByClassName(opponent + 'stick').item(0).style.cssText
		= 'display: none;';
	if (board[red_to_move ? 8 : 0][red_to_move ? 8 : 0]) {
		document.getElementsByClassName(to_move + 'stick')
			.item(0).style.cssText = 'pointer-events: none;';
	} else {
		document.getElementsByClassName(to_move + 'stick')
			.item(0).removeAttribute('style');
	}
	Array.prototype.forEach.call(
		document.getElementsByClassName(to_move + 'piece'),
		(el) => el.removeAttribute('opponent')
	);
	Array.prototype.forEach.call(
		document.getElementsByClassName(opponent + 'piece'),
		(el) => el.setAttribute('opponent', 'opponent')
	);
}
const board_element = document.getElementById('board');
let active_piece = null;
let drag_origin_x = 0;
let drag_origin_y = 0;
let active_square = {element: null};

const piece_strings = [undefined, 'rock', 'paper', 'scissors'];
const setUpBoard = () => {
	let board_html = '';
	// The top of the board is the last row.
	for (let y = 9; y-- > 0;) {
		for (let x = 0; x < 9; x++) {
			const piece = board[y][x];
			const cell_name = getSquareName(x, y);
			board_html
				+= `<div class="cell" id="${cell_name}">`
					+ (
						piece !== 0
							? `<span class="${piece & 4 ? 'red' : 'blue'} piece"><svg viewBox="0 0 1 1">`
								+ '<use'
									+ ` href="./assets/webgoat/${piece_strings[piece & 3]}.svg#svg"`
									+ ' x="0" y="0" width="1" height="1"'
								+ '>'
							+ '</span>'
							: ''
					)
					+ (x === 8 ? `<span class="row coord">${cell_name[1]}</span>` : '')
					+ (y === 0 ? `<span class="column coord">${cell_name[0]}</span>` : '')
					+ (x === 8 && y == 8 ? '<span class="red stick" title="Talking Stick"></span>' : '')
					+ (x === 0 && y == 0 ? '<span class="blue stick" title="Talking Stick"></span>' : '')
				+ '</div>';
		}
	}
	board_element.innerHTML = board_html;
	Array.prototype.forEach.call(document.getElementsByClassName('cell'), (el) => {
		el.addEventListener('click', (e) => {
			if (e.button !== 0 || active_piece || !active_square.clicked) {
				return false;
			}
			const {x: tx, y: ty} = getNamedSquare(el.id);
			if (tx < 0 || tx > 8 || ty < 0 || ty > 8) {
				return false;
			}
			const {x: px, y: py} = active_square;
			if (px === tx && py === ty) {
				return false;
			}
			clearActiveSquare();
			movePiece(px, py, tx, ty, false);
		})
	});
	Array.prototype.forEach.call(document.getElementsByClassName('piece'), (el) => {
		el.addEventListener('mousedown', (e) => {
			if (e.button !== 0) {
				return false;
			}
			const parent = el.parentElement;
			const {x, y} = getNamedSquare(parent.id);
			if (!(board[y][x] & 4) === red_to_move) {
				return false;
			}
			if (active_square.element !== parent) {
				active_square.element?.removeAttribute('active');
				active_square.x = x;
				active_square.y = y;
				drawLegals();
			}
			active_square.element = parent;
			active_square.element.setAttribute('active', 'active');
			el.setAttribute('active', 'active');
			drag_origin_x = e.pageX;
			drag_origin_y = e.pageY;
			active_piece = el;
			return dragPiece(e);
		});
	});
	setSide();
};
setUpBoard();
setSide();

/* ------------------------------ Move history ------------------------------ */

const getNotation = (move, ascii) => getSquareName(move.px, move.py)
		+ (move.captured ? ascii ? 'x' : '&times;' : ascii ? '-' : '&ndash;&NoBreak;')
		+ getSquareName(move.tx, move.ty);
// 97 is 'a'.
const getMoveUCI = (move) => String.fromCharCode(
	move.px + 97, move.py + 49,
	move.tx + 97, move.tx + 49
);
const getMoveNumeric
	= (move) => move.px | (move.py << 4) | (move.tx << 8) | (move.ty << 12);

const navigateToMove = (variation_id, idx) => {
	let common_ancestor_id = current_variation_id;
	let variation_common_idx = idx;
	let variation_idx_hist;
	let variation_root_hist;
	if (current_variation_id !== variation_id) {
		variation_idx_hist = [];
		variation_root_hist = [];
		let variation_ancestor_id = variation_id;
		let c0 = history_tree.get(common_ancestor_id)[0];
		let v = history_tree.get(variation_ancestor_id);
		let v0 = v[0];
		while (common_ancestor_id !== variation_ancestor_id) {
			if (!c0.depth && !v0.depth) {
				throw Error('Move history tree has two roots!');
			}
			if (c0.depth >= v0.depth) {
				common_ancestor_id = c0.from;
				c0 = history_tree.get(common_ancestor_id)[0];
			}
			// If the two were equal, this will now be true.
			if (c0.depth < v0.depth) {
				variation_ancestor_id = v0.from;
				variation_idx_hist.push(variation_common_idx);
				variation_root_hist.push(getMoveNumeric(v[1]));
				variation_common_idx = v0.from_idx;
				v = history_tree.get(variation_ancestor_id);
				v0 = v[0];
			}
		}
	}

	const should_animate = !matchMedia('(prefers-reduced-motion)').matches;
	// In order to animate, we need to know where the pieces came from.
	let old_from_new;
	if (should_animate) {
		old_from_new = new Int8Array(81).map((_, i) => board[Math.floor(i / 9)][i % 9] ? i : -1);
	}

	const stepForward = () => {
		const item = current_variation[++current_history_idx];
		if (typeof(item) !== 'object') {
			return;
		}
		if (should_animate) {
			const old = 9 * item.py + item.px;
			old_from_new[9 * item.ty + item.tx] = old_from_new[old];
			old_from_new[old] = -1;
		}
		rule50 = board[item.ty][item.tx] ? 0 : rule50 + 1;
		board[item.ty][item.tx] = board[item.py][item.px];
		board[item.py][item.px] = 0;
		if (red_to_move) {
			current_fullmove++;
		}
		red_to_move = !red_to_move;
	};
	const stepBackward = () => {
		const item = current_variation[current_history_idx--];
		if (typeof(item) !== 'object') {
			return;
		}
		if (should_animate) {
			const old = 9 * item.ty + item.tx;
			old_from_new[9 * item.py + item.px] = old_from_new[old];
			old_from_new[old] = -1;
		}
		board[item.py][item.px] = board[item.ty][item.tx];
		board[item.ty][item.tx] = item.captured;
		rule50 = item.rule50_before;
		if (!red_to_move) {
			current_fullmove--;
		}
		red_to_move = !red_to_move;
	}
	while (current_variation_id !== common_ancestor_id) {
		while (current_history_idx > 0) {
			stepBackward();
		}
		const header = current_variation[0];
		current_variation_id = header.from;
		current_variation = history_tree.get(current_variation_id);
		current_history_idx = header.from_idx;
	}
	if (current_history_idx < variation_common_idx) {
		do {
			stepForward();
		} while (current_history_idx < variation_common_idx);
	} else if (current_history_idx > variation_common_idx) {
		do {
			stepBackward();
		} while (current_history_idx > variation_common_idx);
	}
	while (current_variation_id !== variation_id) {
		const variations = current_variation[current_history_idx].variations;
		const target_root = variation_root_hist.pop();
		for (let i = 0; i < variations.length; i++) {
			if (variations[i][0] === target_root) {
				current_variation_id = variations[i][1];
				break;
			}
		}
		current_variation = history_tree.get(current_variation_id);
		current_history_idx = 0;
		const target = variation_idx_hist.pop();
		while (current_history_idx < target) {
			stepForward();
		}
	}

	setUpBoard();
	if (should_animate) {
		const cell_size
			= document.getElementsByClassName('cell').item(0).getBoundingClientRect().width;
		Array.prototype.forEach.call(document.getElementsByClassName('piece'), (el) => {
			const {x, y} = getNamedSquare(el.parentElement.id);
			const new_pos = 9 * y + x;
			const old_pos = old_from_new[new_pos];
			if (old_pos !== -1) {
				if (old_pos === new_pos) {
					return;
				}
				const off_x = cell_size * (old_pos % 9 - x);
				const off_y = cell_size * (y - Math.floor(old_pos / 9));
				el.style.cssText
					= `transition: none; transform: translateX(${off_x}px) translateY(${off_y}px);`;
			} else {
				el.style.cssText = `transition: none; opacity: 0%;`;
			}
			setTimeout(() => el.removeAttribute('style'));
		});
	}

	const active = document.getElementsByClassName('current').item(0);
	active.className
		= active.className.split(' ').map((s) => s === 'current' ? '' : s).join(' ');
	document.getElementById(`${variation_id}:${idx}`).className += ' current';
}

/** @param {MouseEvent} e */
const moveCallback = (e) => {
	navigateToMove(...e.target.id.split(':').map(Number));
};
const getVariationHTML = (id, ply, current_ply) => {
	let moves_html = '<li>'
	const variation = history_tree.get(id);
	for (let i = 1; i < variation.length; i++) {
		let current = variation[i];
		moves_html
			+= '<span'
				+ ' class="variation-move' + (
					current_variation_id === id && ply === current_ply
							? ' current'
							: ''
				) + '"'
				+ ` id="${id}:${i}"`
			+ '>'
				+ `${(ply >> 1) + 1}${ply & 1 ? '&hellip;' : '.'}&nbsp;`
				+ getNotation(current, false)
			+ '</span>&ZeroWidthSpace;';
		ply++;
		if (current.variations) {
			moves_html += '<ul class="variation">';
			for (const v of current.variations) {
				moves_html += getVariationHTML(v[1], ply, current_ply);
			}
			moves_html += '</ul>';
			if (i === variation.length) {
				break;
			}
		}
	}
	return moves_html;
}
const moves_element = document.getElementById('moves');
const printMoves = () => {
	const root_variation = history_tree.get(0);
	if (root_variation.length < 2) {
		moves_element.innerHTML = '';
		return;
	}
	let moves_html = '';
	let have_fullmove_label = false;
	const current_ply = 2 * current_fullmove + Number(red_to_move) - 3;
	let ply = root_variation[0].from_idx;
	for (let i = 1; i < root_variation.length; i++) {
		let current = root_variation[i];
		if (!(ply & 1) || !have_fullmove_label) {
			moves_html += `<div class="move-number">${(ply >> 1) + 1}</div>`;
			if (ply & 1) {
				moves_html += '<div class="move gap">&hellip;</div>'
			}
			have_fullmove_label = true;
		}
		moves_html
			+= '<div'
				+ ' class="move' + (
					current_variation_id === 0 && ply === current_ply
							? ' current'
							: ''
				) + '"'
				+ ` id="0:${i}"`
			+ `>${getNotation(current, false)}</div>`;
		ply++;
		if (current.variations) {
			moves_html += '<div class="variation-box"><ul class="variation">';
			for (const v of current.variations) {
				moves_html += getVariationHTML(v[1], ply, current_ply);
			}
			moves_html += '</ul></div>';
			if (i === root_variation.length) {
				break;
			}
			have_fullmove_label = false;
		}
	}
	moves_element.innerHTML = moves_html;
	Array.prototype.forEach.call(
		document.getElementsByClassName('move'),
		(el) => el.addEventListener('click', moveCallback)
	);
	Array.prototype.forEach.call(
		document.getElementsByClassName('variation-move'),
		(el) => el.addEventListener('click', moveCallback)
	);
}

/* ----------------------------- Piece movement ----------------------------- */

const couldTake = (piece, target_piece) => {
	// The piece has to be ours.
	if (!(piece & 3) || !!(piece & 4) !== red_to_move) {
		return false;
	}
	// We can always capture air.
	if (!target_piece) {
		return true;
	}
	// We can't capture our own pieces.
	if ((target_piece & 4) == (piece & 4)) {
		return false;
	}
	// it's like we're in some king of intransitive capture system
	switch (target_piece & 3) {
		case ROCK:
			if ((piece & 3) !== PAPER) {
				return false;
			}
			break;
		case PAPER:
			if ((piece & 3) !== SCISSORS) {
				return false;
			}
			break;
		case SCISSORS:
			if ((piece & 3) !== ROCK) {
				return false;
			}
		default:
	}
	return true;
};
const move_svg
	= '<svg viewBox="0 0 14 14" class="dot"><circle cx="7" cy="7" r="2" /></svg>';
const capture_svg = '<svg viewBox="2 2 30 30" class="dot"><path d="'
		+ 'M 2 2 h 30 v 30 h -30 Z M 0 17 a 17 17 0 0 0 34 0 a 17 17 0 0 0 -34 0 Z'
	+ '" /></svg>';
const drawLegals = () => {
	const active_x = active_square.x;
	const active_y = active_square.y;
	if (typeof(active_x) === 'undefined'
			|| typeof(active_y) === 'undefined') {
		return;
	}
	const piece = board[active_y][active_x];
	for (let off_y = -1; off_y <= 1; off_y++) {
		const y = active_y + off_y;
		if (y < 0 || y > 8) {
			continue;
		}
		for (let off_x = -1; off_x <= 1; off_x++) {
			if (!off_x && !off_y) {
				continue;
			}
			const x = active_x + off_x;
			if (x < 0 || x > 8) {
				continue;
			}
			const target_piece = board[y][x];
			if (!couldTake(piece, target_piece)) {
				continue;
			}
			const square_element = document.getElementById(getSquareName(x, y));
			if (target_piece) {
				square_element.innerHTML += capture_svg;
			} else {
				square_element.innerHTML += move_svg;
			}
		}
	}
};
const clearLegals = () => {
	[...document.getElementsByClassName('dot')].forEach((el) => el.remove());
};

const movePiece = (px, py, tx, ty, from_drag) => {
	// Pieces move like kings.
	if (px == tx && py == ty || Math.abs(tx - px) > 1 || Math.abs(ty - py) > 1) {
		return false;
	}
	const piece = board[py][px];
	const target_piece = board[ty][tx];
	if (!couldTake(piece, target_piece)) {
		return false;
	}
	board[py][px] = 0;
	board[ty][tx] = piece;
	current_fullmove += Number(red_to_move);
	red_to_move = !red_to_move;
	const move = {
		px: px, py: py,
		tx: tx, ty: ty,
		captured: target_piece,
		rule50_before: rule50,
		variations: null,
	};
	rule50 = target_piece ? 0 : rule50 + 1;
	put_move: do {
		// why doesn't javascript have goto
		if (current_history_idx === current_variation.length - 1) {
			current_variation[++current_history_idx] = move;
			break put_move;
		}
		const next = current_variation[current_history_idx + 1];
		if (next.px === px && next.py === py && next.tx === tx && next.ty === ty) {
			current_history_idx++;
			break put_move;
		}
		const prev = current_variation[current_history_idx];
		const move_numeric = getMoveNumeric(move);
		let prev_variations;
		if (!prev.variations) {
			prev.variations = [];
			prev_variations = prev.variations;
		} else {
			prev_variations = prev.variations;
			for (let i = 0; i < prev_variations.length; i++) {
				if (prev_variations[i][0] !== move_numeric) {
					continue;
				}
				current_variation_id = prev_variations[i][1];
				current_variation = history_tree.get(current_variation_id);
				current_history_idx = 1;
				break put_move;
			}
		}
		const id = getNextID();
		history_tree.set(id, [
			{
				from: current_variation_id,
				from_idx: current_history_idx,
				depth: current_variation[0].depth + 1
			},
			move,
		]);
		prev.variations.push([move_numeric, id]);
		current_variation = history_tree.get(id);
		current_variation_id = id;
		current_history_idx = 1;
	} while (false);
	// TODO: immediate mode garbage
	printMoves();

	const piece_element = document.getElementById(getSquareName(px, py))
			.getElementsByClassName('piece')
			.item(0);
	if (!piece_element) {
		throw Error('Tried to move logical piece which doesn\'t exist in the DOM.');
	}
	piece_element.remove();
	const target_square = document.getElementById(getSquareName(tx, ty));
	target_square.getElementsByClassName('piece').item(0)?.remove();
	target_square.appendChild(piece_element);
	// We need to clone the collection since we're messing with it while iterating.
	[...document.getElementsByClassName('previous cell')]
		.forEach((el) => el.className = 'cell');
	document.getElementById(getSquareName(px, py)).className = 'previous cell';
	document.getElementById(getSquareName(tx, ty)).className = 'previous cell';
	setSide();
	if (from_drag || matchMedia?.('(prefers-reduced-motion)')?.matches) {
		return true;
	}
	const rect = board_element.getBoundingClientRect();
	// The board should be square.
	const size = (rect.width - 2) / 9;
	piece_element.style.cssText = 'transition: none; '
			// The y-axis is inverted.
			+ `transform: translate(${(px - tx) * size}px, ${(ty - py) * size}px);`;
	setTimeout(() => piece_element.removeAttribute('style'));
	return true;
}

/**
 * Gets the cell on the board the mouse is currently in.
 *
 * @param {MouseEvent} e A mouse event to get the cell from.
 *
 * @return {{x: number, y: number}} The moused cell. Always returns a structure
 *     in the form `{x, y}`, where `x` and `y` are numeric values from 0 to 8
 *     representing the cell. The returned values may be negative or above 8,
 *     however, so they must be validated.
 */
const getMousedCell = (e) => {
	const board_rect = board_element.getBoundingClientRect();
	return {
		x: Math.floor(9 * (e.x - board_rect.x) / board_rect.width),
		y: 8 - Math.floor(9 * (e.y - board_rect.y) / board_rect.height)
	};
}

const clearActiveSquare = () => {
	clearLegals();
	active_square.x = undefined;
	active_square.y = undefined;
	if (active_square.element) {
		active_square.element.removeAttribute('active');
		active_square.element = null;
	}
	active_square.clicked = false;
};
const dragRelease = (e) => {
	if (!active_piece) {
		return false;
	}
	const piece = active_piece;
	active_piece = null;
	const {x: tx, y: ty} = getMousedCell(e);
	if (0 <= tx && tx <= 8 && 0 <= ty && ty <= 8) {
		const parent = piece.parentElement;
		const {x: px, y: py} = getNamedSquare(parent.id);
		if (px === tx && py === ty && !active_square.clicked) {
			active_square.clicked = true;
		} else {
			clearActiveSquare();
			movePiece(px, py, tx, ty, true);
		}
	}
	piece.removeAttribute('active');
	if (matchMedia?.('(prefers-reduced-motion)')?.matches) {
		piece.removeAttribute('style');
		return true;
	}
	piece.style.cssText = 'transition: none; transform: scale(0.925);';
	setTimeout(() => piece.removeAttribute('style'));
	return true;
};
document.addEventListener('mouseup', dragRelease);
const dragPiece = (e) => {
	if (!(e.buttons & 1)) {
		return dragRelease(e);
	}
	if (!active_piece) {
		return false;
	}
	const rect = active_piece.parentElement.getBoundingClientRect();
	active_piece.style.cssText = `left: ${e.x - rect.x - 0.5 * rect.width}px;`
			+ ` top: ${e.y - rect.y - 0.5 * rect.height}px;`;
};
document.addEventListener('mousemove', dragPiece);

Array.prototype.forEach.call(document.getElementsByClassName('icon'), (el) => {
	let active = false;
	el.addEventListener('click', () => {
		active = !active;
		if (active) {
			el.setAttribute('active', 'active');
		} else {
			el.removeAttribute('active');
		}
	});
});

/* --------------------------------- Arrows --------------------------------- */

const arrowCircle = (x, y, color, is_ghost) => '<circle'
		+ ` id="${is_ghost ? 'ghost' : `arr${x}${y}${x}${y}`}"`
		+ (is_ghost ? 'opacity="0.707"' : '')
		+ ` cx="${x}" cy="${y}"`
		+ ' r="0.46875"'
		+ ' fill="none"'
		+ ` stroke="var(--color-${color})"`
		+ ' stroke-width="0.0625" />';
const arrowPoint = (px, py, tx, ty, color, is_ghost) => {
	// We have to manually subtract the stroke width from the length.
	const w = tx - px, h = ty - py;
	const norm = 0.15625 / Math.hypot(w, h);
	return '<line'
		+ ` id="${is_ghost ? 'ghost' : `arr${px}${py}${tx}${ty}`}"`
		+ (
			tx < 0 || tx > 8 || ty < 0 || ty > 8
				? 'opacity="0.293"'
				: is_ghost ? 'opacity="0.707"' : ''
		)
		+ ` x1="${px}" y1="${py}"`
		+ ` x2="${tx - w * norm}" y2="${ty - h * norm}"`
		+ ` stroke="var(--color-${color})"`
		+ ' stroke-width="0.15625"'
		+ ' stroke-linecap="round"'
		+ ` marker-end="url(#arrowhead-${color})" />`;
};

const arrow_element = document.getElementById('arrows-inner');
const drawn_arrows = new Map();
const drawArrow = (px, py, tx, ty, color) => {
	if (tx < 0 || tx > 8 || ty < 0 || ty > 8) {
		return;
	}
	const arrow_id = `arr${px}${py}${tx}${ty}`;
	const entry = drawn_arrows.get(arrow_id);
	if (typeof(entry) !== 'undefined') {
		document.getElementById(arrow_id).remove();
		if (entry === color) {
			drawn_arrows.delete(arrow_id);
			return;
		}
	}
	drawn_arrows.set(arrow_id, color);
	arrow_element.innerHTML += px === tx && py === ty
			? arrowCircle(px, py, color, false)
			: arrowPoint(px, py, tx, ty, color, false);
};

let ghost = {present: false};
const drawGhost = () => {
	const arrow_id = `arr${ghost.px}${ghost.py}${ghost.tx}${ghost.ty}`;
	const entry = drawn_arrows.get(arrow_id);
	if (typeof(entry) !== 'undefined') {
		document.getElementById(arrow_id).setAttribute(
			'opacity',
			entry === ghost.color ? '0.293' : '0'
		);
		if (entry === ghost.color) {
			return;
		}
	}
	arrow_element.innerHTML += ghost.px === ghost.tx && ghost.py === ghost.ty
			? arrowCircle(ghost.px, ghost.py, ghost.color, true)
			: arrowPoint(ghost.px, ghost.py, ghost.tx, ghost.ty, ghost.color, true);
};
const eraseGhost = () => {
	const arrow_id = `arr${ghost.px}${ghost.py}${ghost.tx}${ghost.ty}`;
	const entry = drawn_arrows.get(arrow_id);
	if (typeof(entry) !== 'undefined') {
		document.getElementById(arrow_id).removeAttribute('opacity');
		if (entry === ghost.color) {
			return;
		}
	}
	document.getElementById('ghost').remove();
};
board_element.addEventListener('mousedown', (e) => {
	if (e.button !== 2) {
		drawn_arrows.clear();
		arrow_element.innerHTML = '';
		return false;
	}
	const {x, y} = getMousedCell(e);
	if (x < 0 || x > 8 || y < 0 || y > 8) {
		return false;
	}
	ghost.px = ghost.tx = x;
	ghost.py = ghost.ty = 8 - y;
	ghost.color = 1 * Number(e.shiftKey) | 2 * Number(e.ctrlKey) | 4 * Number(e.altKey);
	drawGhost();
	ghost.present = true;
	return true;
});
document.addEventListener('mousemove', (e) => {
	if (!ghost.present) {
		return false;
	}
	if (!(e.buttons & 2)) {
		eraseGhost();
		ghost.present = false;
		return false;
	}
	const {x, y} = getMousedCell(e);
	if (ghost.tx === x && ghost.ty === y) {
		return true;
	}
	eraseGhost();
	ghost.tx = x;
	ghost.ty = 8 - y;
	drawGhost();
	return true;
});
document.addEventListener('mouseup', (e) => {
	if (e.button !== 2 || !ghost.present) {
		return false;
	}
	eraseGhost();
	ghost.present = false;
	drawArrow(ghost.px, ghost.py, ghost.tx, ghost.ty, ghost.color);
});

// // A chess pawn's approximate value in Intransitive pieces.
// const PAWN_VALUE = 0.1861797350519155;
