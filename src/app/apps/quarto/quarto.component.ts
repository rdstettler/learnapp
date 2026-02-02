import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, signal } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Piece attributes: [Color(0=Dark,1=Light), Shape(0=Round,1=Square), Height(0=Short,1=Tall), Top(0=Solid,1=Hollow)]
interface PieceUserData {
    id: number;
    attr: [number, number, number, number];
    isPiece: boolean;
    onBoard?: boolean;
    homePosition?: { x: number; z: number } | null;
}

interface SlotUserData {
    isSlot: boolean;
    index: number;
}

type GamePhase = 'PICK' | 'PLACE';

interface GameState {
    board: (THREE.Group | null)[];
    availablePieces: THREE.Group[];
    selectedPiece: THREE.Group | null;
    currentPlayer: number;
    phase: GamePhase;
    gameOver: boolean;
}

@Component({
    selector: 'app-quarto',
    standalone: true,
    imports: [],
    templateUrl: './quarto.component.html',
    styleUrl: './quarto.component.css'
})
export class QuartoComponent implements AfterViewInit, OnDestroy {
    @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

    // UI State
    statusMessage = signal<string>('Player 1: Pick a piece for Player 2');
    subStatusMessage = signal<string>('Select a piece from the side pool');
    showResetButton = signal<boolean>(false);
    statusColor = signal<string>('#ffcc00');

    // Three.js objects
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private controls!: OrbitControls;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private selectionRing!: THREE.Mesh;
    private hoverRing!: THREE.Mesh;
    private animationId!: number;

    // Materials
    private matDark!: THREE.MeshStandardMaterial;
    private matLight!: THREE.MeshStandardMaterial;
    private matBoard!: THREE.MeshStandardMaterial;
    private matSelected!: THREE.MeshBasicMaterial;
    private matHover!: THREE.MeshBasicMaterial;

    // Constants
    private readonly BOARD_OFFSET_X = -5;
    private readonly POOL_OFFSET_X = 6;
    private readonly TILE_SIZE = 2.2;

    // Game State
    private STATE: GameState = {
        board: Array(16).fill(null),
        availablePieces: [],
        selectedPiece: null,
        currentPlayer: 1,
        phase: 'PICK',
        gameOver: false
    };

    ngAfterViewInit(): void {
        this.initThreeJS();
        this.initGame();
        this.animate();
        this.updateUI();

        window.addEventListener('resize', this.onWindowResize);
        this.renderer.domElement.addEventListener('click', this.handleInteraction);
        this.renderer.domElement.addEventListener('mousemove', this.handleHover);
    }

    ngOnDestroy(): void {
        window.removeEventListener('resize', this.onWindowResize);
        this.renderer.domElement.removeEventListener('click', this.handleInteraction);
        this.renderer.domElement.removeEventListener('mousemove', this.handleHover);
        cancelAnimationFrame(this.animationId);

        this.renderer.dispose();
        this.controls.dispose();
    }

    private initThreeJS(): void {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202025);
        this.scene.fog = new THREE.Fog(0x202025, 15, 40);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.canvasContainer.nativeElement.clientWidth / this.canvasContainer.nativeElement.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 15, 18);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(
            this.canvasContainer.nativeElement.clientWidth,
            this.canvasContainer.nativeElement.clientHeight
        );
        this.renderer.shadowMap.enabled = true;
        this.canvasContainer.nativeElement.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(5, 15, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // Materials
        this.matDark = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.4 });
        this.matLight = new THREE.MeshStandardMaterial({ color: 0xF5DEB3, roughness: 0.4 });
        this.matBoard = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2, metalness: 0.1 });
        this.matSelected = new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true });
        this.matHover = new THREE.MeshBasicMaterial({ color: 0x44ffff, transparent: true, opacity: 0.6 });

        // Selection Ring
        this.selectionRing = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.1, 16, 100),
            this.matSelected
        );
        this.selectionRing.rotation.x = Math.PI / 2;
        this.selectionRing.visible = false;
        this.scene.add(this.selectionRing);

        // Hover Ring
        this.hoverRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.9, 0.08, 16, 100),
            this.matHover
        );
        this.hoverRing.rotation.x = Math.PI / 2;
        this.hoverRing.visible = false;
        this.scene.add(this.hoverRing);
    }

    private initGame(): void {
        // Create Board Base
        const boardBase = new THREE.Mesh(
            new THREE.BoxGeometry(9, 0.5, 9),
            this.matBoard
        );
        boardBase.position.set(this.BOARD_OFFSET_X, -0.25, 0);
        boardBase.receiveShadow = true;
        this.scene.add(boardBase);

        // Create Board Slots
        for (let i = 0; i < 16; i++) {
            const x = (i % 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE) + this.BOARD_OFFSET_X;
            const z = Math.floor(i / 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE);

            // Visual marker
            const slotMark = new THREE.Mesh(
                new THREE.CylinderGeometry(0.8, 0.8, 0.1, 32),
                new THREE.MeshStandardMaterial({ color: 0x222222 })
            );
            slotMark.position.set(x, 0.1, z);
            slotMark.receiveShadow = true;
            this.scene.add(slotMark);

            // Invisible collider
            const collider = new THREE.Mesh(
                new THREE.BoxGeometry(this.TILE_SIZE * 0.9, 1, this.TILE_SIZE * 0.9),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            collider.position.set(x, 0.5, z);
            (collider.userData as SlotUserData) = { isSlot: true, index: i };
            this.scene.add(collider);
        }

        // Generate 16 Pieces
        let id = 0;
        for (let c = 0; c < 2; c++) {
            for (let s = 0; s < 2; s++) {
                for (let h = 0; h < 2; h++) {
                    for (let t = 0; t < 2; t++) {
                        const piece = this.createPieceMesh([c, s, h, t] as [number, number, number, number], id++);
                        this.scene.add(piece);
                        this.STATE.availablePieces.push(piece);
                    }
                }
            }
        }

        // Arrange pieces in pool
        this.arrangePool();
    }

    private createPieceMesh(attr: [number, number, number, number], id: number): THREE.Group {
        const isLight = attr[0] === 1;
        const isSquare = attr[1] === 1;
        const isTall = attr[2] === 1;
        const isHollow = attr[3] === 1;

        const height = isTall ? 2.0 : 1.2;
        const width = 1.0;

        let geometry: THREE.BufferGeometry;
        if (isSquare) {
            geometry = new THREE.BoxGeometry(width, height, width);
        } else {
            geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 32);
        }

        const material = isLight ? this.matLight : this.matDark;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const group = new THREE.Group();
        group.add(mesh);

        // Shift mesh up so pivot is at bottom
        mesh.position.y = height / 2;

        // Add Hollow Indicator
        if (isHollow) {
            const capSize = width * 0.6;
            let capGeo: THREE.BufferGeometry;
            if (isSquare) {
                capGeo = new THREE.BoxGeometry(capSize, 0.1, capSize);
            } else {
                capGeo = new THREE.CylinderGeometry(capSize / 2, capSize / 2, 0.1, 32);
            }

            const capMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
            const cap = new THREE.Mesh(capGeo, capMat);
            cap.position.y = height + 0.01;
            group.add(cap);
        }

        // Metadata
        (group.userData as PieceUserData) = {
            id: id,
            attr: attr,
            isPiece: true,
            homePosition: null
        };

        return group;
    }

    private arrangePool(): void {
        const cols = 4;
        this.STATE.availablePieces.forEach((p, idx) => {
            const userData = p.userData as PieceUserData;
            if (!userData.onBoard && p !== this.STATE.selectedPiece) {
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                const x = this.POOL_OFFSET_X + (col * 1.5);
                const z = (row * 1.5) - 3;

                p.position.set(x, 0, z);
                userData.homePosition = { x, z };
            }
        });
    }

    private checkWin(): boolean {
        const b = this.STATE.board;
        const lines = [
            // Rows
            [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
            // Cols
            [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
            // Diags
            [0, 5, 10, 15], [3, 6, 9, 12]
        ];

        for (const line of lines) {
            const pieces = line.map(i => b[i]);
            if (pieces.includes(null)) continue;

            for (let attrIdx = 0; attrIdx < 4; attrIdx++) {
                const firstVal = (pieces[0]!.userData as PieceUserData).attr[attrIdx];
                if (pieces.every(p => (p!.userData as PieceUserData).attr[attrIdx] === firstVal)) {
                    return true;
                }
            }
        }
        return false;
    }

    private updateUI(): void {
        if (this.STATE.gameOver) {
            this.statusMessage.set(`GAME OVER! Player ${this.STATE.currentPlayer} Wins!`);
            this.subStatusMessage.set('Check the board to see the matching row/col/diag.');
            this.statusColor.set('#ff5555');
            this.showResetButton.set(true);
            return;
        }

        if (this.STATE.phase === 'PICK') {
            this.statusMessage.set(`Player ${this.STATE.currentPlayer}: Pick a piece`);
            this.subStatusMessage.set(`Choose a piece for Player ${this.STATE.currentPlayer === 1 ? 2 : 1} to place.`);
            this.statusColor.set(this.STATE.currentPlayer === 1 ? '#ffcc00' : '#00ccff');
        } else {
            this.statusMessage.set(`Player ${this.STATE.currentPlayer}: Place the piece`);
            this.subStatusMessage.set('Click an empty slot on the board.');
            this.statusColor.set(this.STATE.currentPlayer === 1 ? '#ffcc00' : '#00ccff');
        }
    }

    private handleInteraction = (event: MouseEvent): void => {
        if (this.STATE.gameOver) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        if (intersects.length > 0) {
            let target = intersects[0].object as THREE.Object3D;
            while (target.parent && target.parent.type !== 'Scene') {
                if ((target.userData as PieceUserData).isPiece || (target.userData as SlotUserData).isSlot) break;
                target = target.parent;
            }

            if (this.STATE.phase === 'PICK') {
                const userData = target.userData as PieceUserData;
                if (userData.isPiece && !userData.onBoard) {
                    this.STATE.selectedPiece = target as THREE.Group;
                    this.STATE.selectedPiece.position.set(0, 1, 0);

                    this.selectionRing.visible = true;
                    this.selectionRing.position.set(0, 0.5, 0);

                    this.STATE.currentPlayer = this.STATE.currentPlayer === 1 ? 2 : 1;
                    this.STATE.phase = 'PLACE';
                    this.updateUI();
                }
            } else if (this.STATE.phase === 'PLACE') {
                const slotData = target.userData as SlotUserData;
                if (slotData.isSlot && this.STATE.board[slotData.index] === null) {
                    const idx = slotData.index;
                    const x = (idx % 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE) + this.BOARD_OFFSET_X;
                    const z = Math.floor(idx / 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE);

                    this.STATE.selectedPiece!.position.set(x, 0, z);
                    (this.STATE.selectedPiece!.userData as PieceUserData).onBoard = true;
                    this.STATE.board[idx] = this.STATE.selectedPiece;

                    this.selectionRing.visible = false;

                    if (this.checkWin()) {
                        this.STATE.gameOver = true;
                        this.updateUI();
                        return;
                    }

                    if (!this.STATE.board.includes(null)) {
                        this.STATE.gameOver = true;
                        this.statusMessage.set('Draw!');
                        this.subStatusMessage.set('No matching lines found.');
                        this.showResetButton.set(true);
                        return;
                    }

                    this.STATE.selectedPiece = null;
                    this.STATE.phase = 'PICK';
                    this.arrangePool();
                    this.updateUI();
                }
            }
        }
    };

    private handleHover = (event: MouseEvent): void => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        this.hoverRing.visible = false;
        this.renderer.domElement.style.cursor = 'default';

        if (intersects.length > 0 && !this.STATE.gameOver) {
            let target = intersects[0].object as THREE.Object3D;
            while (target.parent && target.parent.type !== 'Scene') {
                if ((target.userData as PieceUserData).isPiece || (target.userData as SlotUserData).isSlot) break;
                target = target.parent;
            }

            if (this.STATE.phase === 'PICK') {
                // Highlight available pieces in pick phase
                const userData = target.userData as PieceUserData;
                if (userData.isPiece && !userData.onBoard) {
                    this.hoverRing.position.set(target.position.x, 0.2, target.position.z);
                    this.hoverRing.visible = true;
                    this.renderer.domElement.style.cursor = 'pointer';
                }
            } else if (this.STATE.phase === 'PLACE') {
                // Highlight empty slots in place phase
                const slotData = target.userData as SlotUserData;
                if (slotData.isSlot && this.STATE.board[slotData.index] === null) {
                    const idx = slotData.index;
                    const x = (idx % 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE) + this.BOARD_OFFSET_X;
                    const z = Math.floor(idx / 4) * this.TILE_SIZE - (1.5 * this.TILE_SIZE);
                    this.hoverRing.position.set(x, 0.2, z);
                    this.hoverRing.visible = true;
                    this.renderer.domElement.style.cursor = 'pointer';
                }
            }
        }
    };

    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);

        if (this.STATE.selectedPiece && this.STATE.phase === 'PLACE') {
            this.STATE.selectedPiece.rotation.y += 0.01;
            this.selectionRing.rotation.z -= 0.02;
            this.STATE.selectedPiece.position.x = THREE.MathUtils.lerp(
                this.STATE.selectedPiece.position.x, 0.5, 0.1
            );
            this.STATE.selectedPiece.position.z = THREE.MathUtils.lerp(
                this.STATE.selectedPiece.position.z, 0, 0.1
            );
            this.STATE.selectedPiece.position.y = 2 + Math.sin(Date.now() * 0.002) * 0.2;
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    private onWindowResize = (): void => {
        const width = this.canvasContainer.nativeElement.clientWidth;
        const height = this.canvasContainer.nativeElement.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    };

    resetGame(): void {
        // Clear the scene of all pieces and slots, then reinitialize
        // Simple approach: reload the component
        this.STATE = {
            board: Array(16).fill(null),
            availablePieces: [],
            selectedPiece: null,
            currentPlayer: 1,
            phase: 'PICK',
            gameOver: false
        };

        // Remove all objects from scene except lights
        const objectsToRemove: THREE.Object3D[] = [];
        this.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                objectsToRemove.push(obj);
            }
            if (obj instanceof THREE.Group && (obj.userData as PieceUserData).isPiece) {
                objectsToRemove.push(obj);
            }
        });
        objectsToRemove.forEach(obj => this.scene.remove(obj));

        // Reinitialize
        this.initGame();
        this.selectionRing.visible = false;
        this.scene.add(this.selectionRing);
        this.showResetButton.set(false);
        this.updateUI();
    }
}
