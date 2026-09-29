'use strict';

const ROCK = 1;
const PAPER = 2;
const SCISSORS = 3;
const BLUE = 0;
const RED = 4;

// 65 is 'A', and 49 is '1'.
const getSquareName = (x, y) => String.fromCodePoint(65 + x, 49 + y);
const getNamedSquare = (name) => ({x: name.codePointAt(0) - 65, y: name.codePointAt(1) - 49});

const getStartpos = () => [
	[0, 0, 0, 0, 0, 0, 0, 0, 0],
	[0, 0, 0, 1, 2, 0, 0, 0, 0],
	[0, 0, 1, 2, 3, 0, 0, 0, 0],
	[0, 1, 2, 3, 0, 0, 0, 0, 0],
	[0, 2, 3, 0, 0, 0, 7, 6, 0],
	[0, 0, 0, 0, 0, 7, 6, 5, 0],
	[0, 0, 0, 0, 7, 6, 5, 0, 0],
	[0, 0, 0, 0, 6, 5, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 0, 0, 0],
];
let position = getStartpos();
let red_to_move = false;
let move_history = [];

const piece_letters = ['', 'R', 'P', 'S', '', 'r', 'p', 's'];
const getFen = () => {
	let board_string = '';
	for (let y = 9; y-- > 0;) {
		let empties = 0;
		for (let x = 0; x < 9; x++) {
			const piece = position[y][x];
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
	// i can't make the `DREAMS > DREAMS` joke in JS so please just pretend i did
	return `${board_string} ${red_to_move ? 'r' : 'b'} -`;
};

const giveTalkingStick = () => {
	document.getElementsByClassName(red_to_move ? 'blue stick' : 'red stick')
		.item(0).style.cssText = 'display: none;';
	if (position[red_to_move ? 8 : 0][red_to_move ? 8 : 0]) {
		document.getElementsByClassName(red_to_move ? 'red stick' : 'blue stick')
			.item(0).style.cssText = 'pointer-events: none;';
	} else {
		document.getElementsByClassName(red_to_move ? 'red stick' : 'blue stick')
			.item(0).removeAttribute('style');
	}
}
const piece_strings = ['', 'blue rock', 'blue paper', 'blue scissors', '', 'red rock', 'red paper', 'red scissors'];
const board_element = document.getElementById('board');
let active_piece = null;
let drag_origin_x = 0;
let drag_origin_y = 0;
let drag_bounce_timeout;
const setUpBoard = () => {
	let board_html = '';
	// The top of the board is the last row.
	for (let y = 9; y-- > 0;) {
		for (let x = 0; x < 9; x++) {
			const piece = position[y][x];
			const cell_name = getSquareName(x, y);
			board_html += `<div class="cell" id="${cell_name}">${
					piece !== 0 ? `<span class="${piece_strings[piece]} piece"></span>` : ''
				}${
					x === 8 ? `<span class="row coord">${cell_name[1]}</span>` : ''
				}${
					y === 0 ? `<span class="column coord">${cell_name[0]}</span>` : ''
				}${
					x === 8 && y == 8 ? '<span class="red stick" title="Talking Stick"></span>' : ''
				}${
					x === 0 && y == 0 ? '<span class="blue stick" title="Talking Stick"></span>' : ''
				}</div>`;
		}
	}
	board_element.innerHTML = board_html;
	Array.prototype.forEach.call(document.getElementsByClassName('piece'), (el) => {
		el.addEventListener('mousedown', (e) => {
			if (typeof(drag_bounce_timeout) !== 'undefined') {
				clearTimeout(drag_bounce_timeout);
			}
			el.setAttribute('active', 'active');
			drag_origin_x = e.pageX;
			drag_origin_y = e.pageY;
			active_piece = el;
			return dragPiece(e);
		});
	});
	giveTalkingStick();
};
setUpBoard();

const movePiece = (piece_x, piece_y, target_x, target_y) => {
	// Pieces move like kings.
	if (piece_x == target_x && piece_y == target_y
			|| Math.abs(target_x - piece_x) > 1
			|| Math.abs(target_y - piece_y) > 1) {
		return false;
	}
	const piece = position[piece_y][piece_x];
	// The piece has to be ours.
	if (!(piece & 3) || !!(piece & 4) !== red_to_move) {
		return false;
	}
	// We can't capture our own pieces.
	const target_piece = position[target_y][target_x];
	if (target_piece && (target_piece & 4) == (piece & 4)) {
		return false;
	}
	// it's like we in some king of intransitive capture system
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
	// Seems legal to me!
	position[piece_y][piece_x] = 0;
	position[target_y][target_x] = piece;
	red_to_move = !red_to_move;
	move_history.push([piece_x, piece_y, target_x, target_y]);

	// Update the board.
	const piece_element = document
		.getElementById(getSquareName(piece_x, piece_y))
		.getElementsByClassName('piece')
		.item(0);
	if (!piece_element) {
		throw Error('Tried to move logical piece which doesn\'t exist in the DOM.');
	}
	piece_element.remove();
	const target_square = document.getElementById(getSquareName(target_x, target_y));
	target_square.getElementsByClassName('piece').item(0)?.remove();
	target_square.appendChild(piece_element);
	if (move_history.length > 1) {
		const last_move = move_history[move_history.length - 2];
		document.getElementById(getSquareName(last_move[0], last_move[1])).className = 'cell';
		document.getElementById(getSquareName(last_move[2], last_move[3])).className = 'cell';
	}
	document.getElementById(getSquareName(piece_x, piece_y)).className = 'cell previous';
	document.getElementById(getSquareName(target_x, target_y)).className = 'cell previous';
	giveTalkingStick();
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
const dragRelease = (e) => {
	if (!active_piece) {
		return false;
	}
	const piece = active_piece;
	active_piece = null;
	const {x: tx, y: ty} = getMousedCell(e);
	if (0 <= tx && tx <= 8 && 0 <= ty && ty <= 8) {
		const {x: px, y: py} = getNamedSquare(piece.parentElement.id);
		movePiece(px, py, tx, ty);
	}
	piece.removeAttribute('active');
	piece.removeAttribute('style');
	piece.style.cssText = 'transition: none; width: 91.7%; height: 91.7%;';
	drag_bounce_timeout = setTimeout(() => {
		piece.removeAttribute('style');
		drag_bounce_timeout = undefined;
	});
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
	active_piece.style.cssText = `left: ${e.pageX - rect.x - 0.5 * rect.width}px; top: ${e.pageY - rect.y - 0.5 * rect.height}px;`;
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
