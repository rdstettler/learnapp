import { Component, signal, computed } from '@angular/core';

interface Position {
    x: number;
    y: number;
}

interface Player {
    color: string;
    colorName: string;
    shape: string;
    pos: Position | null;
    active: boolean;
}

type CellState = null | 'blocked' | 'gray';
type GameState = 'setup_grid' | 'setup_players' | 'setup_colors' | 'setup_shapes' | 'placement' | 'gameplay' | 'end';

const COLORS: Record<string, string> = {
    'rot': '#ef4444',
    'grün': '#22c55e',
    'blau': '#3b82f6',
    'gelb': '#eab308',
    'orange': '#f97316'
};

const LIGHT_COLORS: Record<string, string> = {
    'rot': 'rgba(239, 68, 68, 0.3)',
    'grün': 'rgba(34, 197, 94, 0.3)',
    'blau': 'rgba(59, 130, 246, 0.3)',
    'gelb': 'rgba(234, 179, 8, 0.3)',
    'orange': 'rgba(249, 115, 22, 0.3)'
};

const SHAPES = ['Kreuz', 'Kreis', 'Dreieck', 'Zylinder', 'Stern'];

const DIRECTIONS: Position[] = [
    { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 },
    { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
];

@Component({
    selector: 'app-isolation',
    standalone: true,
    templateUrl: './isolation.component.html',
    styleUrl: './isolation.component.css'
})
export class IsolationComponent {
    // Game state signals
    state = signal<GameState>('setup_grid');
    gridSize = signal<Position>({ x: 7, y: 7 });
    numPlayers = signal<number>(2);
    vsComputer = signal<boolean>(false);
    players = signal<Player[]>([]);
    board = signal<CellState[][]>([]);
    currentPlayer = signal<number>(0);
    placementTurn = signal<number>(0);
    message = signal<string>('');

    // Setup state
    availableColors = signal<string[]>(Object.keys(COLORS));
    availableShapes = signal<string[]>([...SHAPES]);
    currentSetupPlayer = signal<number>(1);
    tempColor = signal<string>('');

    // Grid size options
    gridOptions = [5, 6, 7, 8, 9, 10];

    // Computed values
    possibleMoves = computed(() => {
        if (this.state() !== 'gameplay') return [];
        const player = this.players()[this.currentPlayer()];
        if (!player?.pos) return [];
        return this.getPossibleMoves(player.pos);
    });

    highlightColor = computed(() => {
        const player = this.players()[this.currentPlayer()];
        if (!player) return 'rgba(99, 102, 241, 0.3)';
        return LIGHT_COLORS[player.colorName] || 'rgba(99, 102, 241, 0.3)';
    });

    activePlayerCount = computed(() => {
        return this.players().filter(p => p.active).length;
    });

    // Helper getters
    getColors(): string[] {
        return this.availableColors();
    }

    getShapes(): string[] {
        return this.availableShapes();
    }

    getColorValue(name: string): string {
        return COLORS[name] || '#ffffff';
    }

    // Grid setup
    selectGridSize(width: number, height: number): void {
        this.gridSize.set({ x: width, y: height });
        this.initBoard();
        this.state.set('setup_players');
    }

    initBoard(): void {
        const size = this.gridSize();
        const board: CellState[][] = [];
        for (let x = 0; x < size.x; x++) {
            board[x] = [];
            for (let y = 0; y < size.y; y++) {
                board[x][y] = null;
            }
        }
        this.board.set(board);
    }

    // Player setup
    selectPlayerCount(count: number, vsComputer: boolean = false): void {
        this.numPlayers.set(count);
        this.vsComputer.set(vsComputer);
        this.currentSetupPlayer.set(1);
        this.state.set('setup_colors');
    }

    randomizeAll(): void {
        const colors = [...this.availableColors()];
        const shapes = [...this.availableShapes()];
        const newPlayers: Player[] = [];

        for (let i = 0; i < this.numPlayers(); i++) {
            const colorIdx = Math.floor(Math.random() * colors.length);
            const shapeIdx = Math.floor(Math.random() * shapes.length);
            const colorName = colors.splice(colorIdx, 1)[0];
            const shape = shapes.splice(shapeIdx, 1)[0];

            newPlayers.push({
                color: COLORS[colorName],
                colorName,
                shape,
                pos: null,
                active: true
            });
        }

        this.players.set(newPlayers);
        this.availableColors.set(colors);
        this.availableShapes.set(shapes);
        this.placementTurn.set(0);
        this.state.set('placement');
    }

    selectColor(colorName: string): void {
        this.tempColor.set(colorName);
        this.availableColors.update(colors => colors.filter(c => c !== colorName));
        this.state.set('setup_shapes');
    }

    selectShape(shape: string): void {
        const newPlayer: Player = {
            color: COLORS[this.tempColor()],
            colorName: this.tempColor(),
            shape,
            pos: null,
            active: true
        };

        this.players.update(players => [...players, newPlayer]);
        this.availableShapes.update(shapes => shapes.filter(s => s !== shape));

        if (this.currentSetupPlayer() < this.numPlayers()) {
            this.currentSetupPlayer.update(p => p + 1);
            this.state.set('setup_colors');
        } else {
            this.placementTurn.set(0);
            this.state.set('placement');
        }
    }

    // Placement phase
    placePlayer(x: number, y: number): void {
        const board = this.board();
        if (board[x][y] !== null) return;

        // Check if any player is already at this position
        if (this.players().some(p => p.pos?.x === x && p.pos?.y === y)) return;

        // Place current player
        this.players.update(players => {
            const updated = [...players];
            updated[this.placementTurn()] = {
                ...updated[this.placementTurn()],
                pos: { x, y }
            };
            return updated;
        });

        // Mark cell as blocked
        this.updateCell(x, y, 'blocked');

        this.placementTurn.update(t => t + 1);

        if (this.placementTurn() >= this.numPlayers()) {
            this.currentPlayer.set(0);
            this.eliminatePlayers();
            this.state.set('gameplay');
        } else if (this.vsComputer() && this.placementTurn() === 1) {
            // Computer places its piece
            setTimeout(() => this.computerPlace(), 500);
        }
    }

    computerPlace(): void {
        const board = this.board();
        const size = this.gridSize();
        const available: Position[] = [];

        for (let x = 0; x < size.x; x++) {
            for (let y = 0; y < size.y; y++) {
                if (board[x][y] === null && !this.players().some(p => p.pos?.x === x && p.pos?.y === y)) {
                    available.push({ x, y });
                }
            }
        }

        if (available.length > 0) {
            const pos = available[Math.floor(Math.random() * available.length)];
            this.placePlayer(pos.x, pos.y);
        }
    }

    // Gameplay
    movePlayer(x: number, y: number): void {
        if (this.state() !== 'gameplay') return;

        const moves = this.possibleMoves();
        if (!moves.some(m => m.x === x && m.y === y)) return;

        const players = this.players();
        const currentIdx = this.currentPlayer();
        const oldPos = players[currentIdx].pos!;

        // Gray out old position
        this.updateCell(oldPos.x, oldPos.y, 'gray');

        // Move player
        this.players.update(players => {
            const updated = [...players];
            updated[currentIdx] = {
                ...updated[currentIdx],
                pos: { x, y }
            };
            return updated;
        });

        // Block new position
        this.updateCell(x, y, 'blocked');

        // Check eliminations and next player
        this.eliminatePlayers();
        this.nextPlayer();
        this.eliminatePlayers();

        if (this.activePlayerCount() <= 1) {
            const winner = this.players().findIndex(p => p.active);
            this.message.set(`Spieler ${winner + 1} gewinnt!`);
            this.state.set('end');
        } else if (this.vsComputer() && this.currentPlayer() === 1) {
            setTimeout(() => this.computerMove(), 500);
        }
    }

    computerMove(): void {
        const player = this.players()[1];
        if (!player.pos || !player.active) return;

        const moves = this.getPossibleMoves(player.pos);
        if (moves.length > 0) {
            const move = moves[Math.floor(Math.random() * moves.length)];
            this.movePlayer(move.x, move.y);
        }
    }

    updateCell(x: number, y: number, state: CellState): void {
        this.board.update(board => {
            const newBoard = board.map(row => [...row]);
            newBoard[x][y] = state;
            return newBoard;
        });
    }

    getPossibleMoves(pos: Position): Position[] {
        const moves: Position[] = [];
        const board = this.board();
        const size = this.gridSize();

        for (const dir of DIRECTIONS) {
            for (let dist = 1; dist <= Math.max(size.x, size.y); dist++) {
                const newX = pos.x + dist * dir.x;
                const newY = pos.y + dist * dir.y;

                if (newX < 0 || newX >= size.x || newY < 0 || newY >= size.y) break;
                if (board[newX][newY] !== null) break;
                if (this.players().some(p => p.active && p.pos?.x === newX && p.pos?.y === newY)) break;

                // Check path is clear
                if (this.isValidMove(pos, { x: newX, y: newY })) {
                    moves.push({ x: newX, y: newY });
                } else {
                    break;
                }
            }
        }

        return moves;
    }

    isValidMove(start: Position, end: Position): boolean {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx === 0 && dy === 0) return false;

        const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
        const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;

        // Must be straight line (horizontal, vertical, or diagonal)
        if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;

        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const board = this.board();
        const size = this.gridSize();

        for (let d = 1; d < dist; d++) {
            const cx = start.x + d * stepX;
            const cy = start.y + d * stepY;
            if (cx < 0 || cx >= size.x || cy < 0 || cy >= size.y) return false;
            if (board[cx][cy] !== null) return false;
        }

        return board[end.x][end.y] === null;
    }

    canPlayerMove(playerIdx: number): boolean {
        const player = this.players()[playerIdx];
        if (!player.pos) return false;
        return this.getPossibleMoves(player.pos).length > 0;
    }

    eliminatePlayers(): void {
        this.players.update(players => {
            return players.map((player, idx) => {
                if (player.active && !this.canPlayerMoveCheck(player, idx)) {
                    this.message.set(`Spieler ${idx + 1} ist eliminiert!`);
                    return { ...player, active: false };
                }
                return player;
            });
        });
    }

    canPlayerMoveCheck(player: Player, _idx: number): boolean {
        if (!player.pos) return false;
        return this.getPossibleMoves(player.pos).length > 0;
    }

    nextPlayer(): void {
        const players = this.players();
        let next = (this.currentPlayer() + 1) % players.length;
        while (!players[next].active) {
            next = (next + 1) % players.length;
            if (next === this.currentPlayer()) break;
        }
        this.currentPlayer.set(next);
    }

    // Cell helpers
    getCellState(x: number, y: number): CellState {
        return this.board()[x]?.[y] ?? null;
    }

    isHighlighted(x: number, y: number): boolean {
        return this.possibleMoves().some(m => m.x === x && m.y === y);
    }

    getPlayerAt(x: number, y: number): Player | null {
        return this.players().find(p => p.active && p.pos?.x === x && p.pos?.y === y) || null;
    }

    onCellClick(x: number, y: number): void {
        if (this.state() === 'placement') {
            this.placePlayer(x, y);
        } else if (this.state() === 'gameplay') {
            if (this.vsComputer() && this.currentPlayer() === 1) return; // Don't allow clicks during computer turn
            this.movePlayer(x, y);
        }
    }

    // Reset game
    resetGame(): void {
        this.state.set('setup_grid');
        this.players.set([]);
        this.board.set([]);
        this.currentPlayer.set(0);
        this.placementTurn.set(0);
        this.message.set('');
        this.availableColors.set(Object.keys(COLORS));
        this.availableShapes.set([...SHAPES]);
        this.currentSetupPlayer.set(1);
        this.tempColor.set('');
        this.vsComputer.set(false);
    }

    // Shape SVG paths
    getShapeClass(shape: string): string {
        return shape.toLowerCase().replace('ä', 'a').replace('ü', 'u');
    }
}
