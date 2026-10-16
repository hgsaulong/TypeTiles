import Phaser from "phaser";
import { getGreggPrompt, getWordCategory, getWordsForDifficulty, GREGG_PROMPTS, WORD_BANK, type WordCategory } from "../words";
import { PauseMenu } from "./game/PauseMenu";
import { getLaneX, pickLaneNotSame, type Lane } from "./game/lanes";
import { WaterEffects, WATER_TEXTURE_KEY } from "./game/WaterEffects";
import { WordTarget } from "./game/WordTarget";
import type { MatchConfig, GreggSubmode } from "../lib/mockData";
import { FULL_SENTENCE_SPEED_MULTIPLIER, resolveGreggSubmode } from "../lib/greggGameplay";
import { getSoloGreggPrompts, isGreggStenographyCategory } from "../data/greggPrompts";
import { isValidGreggCrop } from "../data/greggCropMappings";
import { PENDING_GREGG_PILOT_MAPPINGS } from "../data/dev/greggPilotMappings";
import { getCategorySentences, type PracticeFormat } from "../../server/src/sentenceBank";

export type GameResult = {
  score: number;
  wpm: number;
  accuracy: number;
  errorRate: number;
  completedWords: number;
  remainingLives: number;
  endReason: "time" | "health";
  mode: string;
  difficulty: string;
  roundTime: number;
  wordSet: string;
  greggSubmode?: GreggSubmode;
  practiceFormat?: PracticeFormat;
};

export type GameMode = "solo" | "multiplayer";

export type GamePerformance = {
  score: number;
  wpm: number;
  accuracy: number;
  lives: number;
  completedWords: number;
  finished: boolean;
};

type GameSceneInitData = {
  mode?: GameMode;
  roomCode?: string;
  matchConfig: MatchConfig;
  onGameOver: (result: GameResult) => void;
  onPerformance?: (performance: GamePerformance) => void;
  onRestart?: () => void;
  onExit?: () => void;
  wordSequence?: string[];
  startAt?: number;
};

export default class GameScene extends Phaser.Scene {
  private static readonly DIFFICULTY_CONFIG = {
    easy: { fallSpeed: 55, minimumLength: 1, maximumLength: 4 },
    normal: { fallSpeed: 75, minimumLength: 5, maximumLength: 7 },
    hard: { fallSpeed: 105, minimumLength: 6, maximumLength: Number.POSITIVE_INFINITY },
  } as const;

  private readonly WATER_FRAME_SIZE = 1000;
  private readonly WATER_LAST_FRAME = 3;
  private matchDurationSeconds = 60;

  // === TUNING ===
  private readonly WORD_FONT_SIZE = 22;
  private readonly TYPED_FONT_SIZE = 26;
  private readonly TILE_HEIGHT = 52;
  private readonly TILE_PADDING_X = 50;
  private fallSpeedPxPerSec: number = GameScene.DIFFICULTY_CONFIG.normal.fallSpeed;
  // ==============

  private typedDisplay!: Phaser.GameObjects.Text;
  private topHudPanel!: Phaser.GameObjects.Rectangle;
  private topHudMetrics: Array<{ label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text }> = [];
  private hudPanel!: Phaser.GameObjects.Rectangle;
  private hudMetrics: Array<{ label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text; color: string }> = [];
  private hudDividers: Phaser.GameObjects.Rectangle[] = [];
  private gameOverDisplay!: Phaser.GameObjects.Text;
  private pauseMenu!: PauseMenu;
  private wordTarget!: WordTarget;
  private waterEffects!: WaterEffects;
  private matchConfig!: MatchConfig;
  private onGameOver!: (result: GameResult) => void;
  private onPerformance?: (performance: GamePerformance) => void;
  private onRestart?: () => void;
  private onExit?: () => void;
  private lastPerformanceReportSecond = -1;
  private gameMode: GameMode = "solo";
  private multiplayerWordSequence: string[] = [];
  private multiplayerWordIndex = 0;
  private wordDeck: string[] = [];
  private wordDeckIndex = 0;
  private isSoloGregg = false;
  private isSoloSentence = false;
  private isGreggCropPilot = false;
  private greggPilotExercise: number | null = null;
  private greggIndex = 0;
  private greggPlayTop = 144;
  private greggPlayBottom = 0;

  private activeWord = "";
  private typedText = "";
  private score = 0;
  private remainingSeconds = 60;
  private elapsedSeconds = 0;
  private completedWords = 0;
  private correctKeystrokes = 0;
  private incorrectKeystrokes = 0;
  private completedCharacters = 0;
  private lives = 3;
  private difficultyKey: keyof typeof GameScene.DIFFICULTY_CONFIG = "normal";
  private wordCategory: WordCategory = "general";
  private endReason: "time" | "health" = "time";
  private gameOver = false;
  private wordX = 0;
  private wordY = 60;
  private lastLane: Lane = "center";

  constructor() {
    super("GameScene");
  }

  init({ mode = "solo", matchConfig, onGameOver, onPerformance, onRestart, onExit, wordSequence }: GameSceneInitData): void {
    this.gameMode = mode;
    this.multiplayerWordSequence = wordSequence && wordSequence.length > 0 ? [...new Set(wordSequence)] : [];
    this.multiplayerWordIndex = 0;
    this.matchConfig = matchConfig;
    this.onGameOver = onGameOver;
    this.onPerformance = onPerformance;
    this.onRestart = onRestart;
    this.onExit = onExit;
    this.matchDurationSeconds = matchConfig.roundTime;
    this.remainingSeconds = this.matchDurationSeconds;
    this.difficultyKey = this.getDifficultyKey(matchConfig.difficulty);
    const selectedExercise = /^Gregg Exercise ([6-9]|10) Crop Pilot$/.exec(matchConfig.wordSet);
    const studentCropPreview = isGreggStenographyCategory(matchConfig.wordSet)
      && resolveGreggSubmode(matchConfig.greggSubmode) === "word-phrase";
    this.isGreggCropPilot = import.meta.env.DEV && mode === "solo"
      && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      && (studentCropPreview || matchConfig.wordSet === "Gregg Exercises 6-10 Crop Pilot" || selectedExercise !== null);
    this.greggPilotExercise = this.isGreggCropPilot && selectedExercise ? Number(selectedExercise[1]) : null;
    this.isSoloGregg = mode === "solo" && (this.isGreggCropPilot || isGreggStenographyCategory(matchConfig.wordSet));
    this.greggIndex = 0;
    this.wordCategory = getWordCategory(matchConfig.wordSet);
    this.isSoloSentence = mode === "solo" && !this.isSoloGregg
      && matchConfig.practiceFormat === "full-sentence"
      && getCategorySentences(matchConfig.wordSet).length > 0;
    if (this.isSoloSentence) {
      this.wordDeck = [...getCategorySentences(matchConfig.wordSet)];
      this.wordDeckIndex = 0;
      this.fallSpeedPxPerSec = GameScene.DIFFICULTY_CONFIG[this.difficultyKey].fallSpeed * 0.5;
      return;
    }
    if (this.isSoloGregg) {
      this.wordDeck = [];
      this.wordDeckIndex = 0;
      this.fallSpeedPxPerSec = GameScene.DIFFICULTY_CONFIG[this.difficultyKey].fallSpeed
        * (this.isGreggCropPilot ? 1 : FULL_SENTENCE_SPEED_MULTIPLIER);
      return;
    }
    const preferredWords = [...new Set(getWordsForDifficulty(this.wordCategory, this.difficultyKey))];
    const preferredWordSet = new Set(preferredWords);
    const remainingCategoryWords = WORD_BANK[this.wordCategory].filter((word) => !preferredWordSet.has(word));
    this.wordDeck = [...this.shuffleWords(preferredWords), ...this.shuffleWords(remainingCategoryWords)];
    this.wordDeckIndex = 0;
    this.fallSpeedPxPerSec = GameScene.DIFFICULTY_CONFIG[this.difficultyKey].fallSpeed;
  }

  preload(): void {
    // Background gif is rendered by CSS so it stays animated.
    this.load.spritesheet(WATER_TEXTURE_KEY, new URL("../assets/waterdrop.jpg", import.meta.url).href, {
      frameWidth: this.WATER_FRAME_SIZE,
      frameHeight: this.WATER_FRAME_SIZE,
    });

    if (this.isSoloGregg) {
      for (const prompt of getSoloGreggPrompts()) {
        if (this.isGreggCropPilot && this.greggPilotExercise !== null && prompt.exerciseNumber !== this.greggPilotExercise) continue;
        const key = this.greggTextureKey(prompt.id);
        if (!this.textures.exists(key)) this.load.image(key, prompt.image);
      }
      // create() checks every required texture after loading, including failed requests.
    } else if (this.wordCategory === "stenography") {
      for (const prompt of GREGG_PROMPTS) {
        this.load.image(prompt.id, prompt.image);
      }
    }
  }

  create(): void {
    const topMetricDefinitions = ["Lives", "Score", "Time"];
    const sideMetricDefinitions = [
      { label: "WPM", color: "#ffffff" },
      { label: "Accuracy", color: "#72d6ff" },
      { label: "Error Rate", color: "#ff665f" },
      { label: "Difficulty", color: "#ffffff" },
    ];
    this.topHudPanel = this.add.rectangle(0, 0, this.scale.width, 58, 0x77818a, 0.72)
      .setOrigin(0)
      .setStrokeStyle(1, 0xb2c0ce, 0.7)
      .setDepth(10);
    this.topHudMetrics = topMetricDefinitions.map((label) => ({
      label: this.add.text(0, 0, label, { fontFamily: "Arial", fontSize: "12px", color: "#ffffff", fontStyle: "bold" }).setDepth(11),
      value: this.add.text(0, 0, "", { fontFamily: "Arial", fontSize: "19px", color: "#ffffff", fontStyle: "bold" }).setDepth(11),
    }));
    this.hudPanel = this.add.rectangle(0, 0, 150, 240, 0x102441, 0.88)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5295be, 0.9)
      .setDepth(10);
    this.hudMetrics = sideMetricDefinitions.map(({ label, color }) => ({
      label: this.add.text(0, 0, label, { fontFamily: "Arial", fontSize: "14px", color: "#ffffff" }).setDepth(11),
      value: this.add.text(0, 0, "", { fontFamily: "Arial", fontSize: "22px", color, fontStyle: "bold" }).setDepth(11),
      color,
    }));
    this.hudDividers = sideMetricDefinitions.slice(1).map(() =>
      this.add.rectangle(0, 0, 150, 1, 0x5295be, 0.75).setOrigin(0).setDepth(11),
    );
    this.layoutHud();

    this.typedDisplay = this.add
      .text(this.scale.width / 2, this.scale.height - 80, "", {
        fontFamily: "monospace",
        fontSize: `${this.TYPED_FONT_SIZE}px`,
        color: "#ffff00",
        backgroundColor: "rgba(0,0,0,0.75)",
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.gameOverDisplay = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.85)",
        align: "center",
        padding: { x: 24, y: 18 },
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setVisible(false);

    this.pauseMenu = new PauseMenu(this, {
      isSolo: this.gameMode === "solo",
      onRestart: () => this.onRestart?.(),
      onExit: () => this.onExit?.(),
    });
    this.waterEffects = new WaterEffects(this, this.WATER_LAST_FRAME);
    this.waterEffects.ensureAnimations();

    this.wordTarget = new WordTarget(this, {
      wordFontSize: this.WORD_FONT_SIZE,
      tileHeight: this.TILE_HEIGHT,
      tilePaddingX: this.TILE_PADDING_X,
    });

    if (!this.isSoloGregg && this.wordCategory === "stenography" && GREGG_PROMPTS.length === 0) {
      this.gameOverDisplay
        .setText("Gregg shorthand assets are not available yet.")
        .setVisible(true);
      this.gameOver = true;
      return;
    }

    if (this.isSoloGregg) this.layoutGreggInput();
    if (this.isSoloSentence) this.layoutSentenceInput();
    this.spawnWord();
    this.updateHud();
    this.reportPerformance();

    const onKeyDown = (event: KeyboardEvent) => {
      if ((this.isSoloGregg || this.isSoloSentence) && (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)) return;
      if (event.key === "Escape") {
        this.pauseMenu.toggle();
        return;
      }

      if ((this.isSoloGregg || this.isSoloSentence) && (event.key.length === 1 || event.key === "Backspace")) event.preventDefault();
      this.handleTyping(event.key);
    };
    this.input.keyboard?.on("keydown", onKeyDown);

    const onResize = (gameSize: Phaser.Structs.Size) => {
      this.typedDisplay.setPosition(gameSize.width / 2, gameSize.height - 80);
      this.gameOverDisplay.setPosition(gameSize.width / 2, gameSize.height / 2);
      this.pauseMenu.layout(gameSize.width, gameSize.height);
      this.layoutHud();

      if (this.isSoloGregg) {
        this.layoutGreggInput();
        if (!this.gameOver) this.layoutGreggTarget(false);
        return;
      }
      if (this.isSoloSentence) {
        this.layoutSentenceInput();
        if (!this.gameOver) this.layoutSentenceTarget(false);
        return;
      }

      this.wordX = getLaneX(gameSize.width, this.lastLane);
      this.wordTarget.setPosition(this.wordX, this.wordY);
    };
    this.scale.on("resize", onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", onKeyDown);
      this.scale.off("resize", onResize);
    });
  }

  update(_: number, delta: number): void {
    if (this.pauseMenu.isPaused || this.gameOver) return;

    const dt = delta / 1000;
    this.elapsedSeconds = Math.min(this.matchDurationSeconds, this.elapsedSeconds + dt);
    this.remainingSeconds = Math.max(0, this.matchDurationSeconds - this.elapsedSeconds);
    this.updateHud();
    this.reportPerformance();

    if (this.remainingSeconds <= 0) {
      this.endMatch();
      return;
    }

    const bottomLimit = this.isSoloGregg || this.isSoloSentence
      ? this.greggPlayBottom - this.wordTarget.height / 2
      : this.scale.height - 120;
    this.wordY = this.isSoloGregg || this.isSoloSentence
      ? Math.min(bottomLimit, this.wordY + this.fallSpeedPxPerSec * dt)
      : this.wordY + this.fallSpeedPxPerSec * dt;
    this.wordTarget.setPosition(this.wordX, this.wordY);

    if (this.wordY >= bottomLimit) {
      this.onMissBottom();
    }
  }

  private spawnWord(): void {
    if (this.isSoloGregg) {
      const prompts = this.greggTargets();
      if (!prompts.length || prompts.some((prompt) => !this.textures.exists(this.greggTextureKey(prompt.textureId)))) {
        this.showGreggUnavailable("Gregg shorthand content could not be loaded. Please restart or exit.");
        return;
      }
      if (this.isGreggCropPilot) {
        // Playable counts; the stored Exercise 7 comma and period are excluded.
        const expectedCounts: Record<number, number> = { 6: 8, 7: 7, 8: 8, 9: 8, 10: 9 };
        const ids = new Set<string>();
        const orders = new Map<number, number>();
        const selectedCounts = this.greggPilotExercise === null ? expectedCounts
          : { [this.greggPilotExercise]: expectedCounts[this.greggPilotExercise] };
        const expectedTotal = Object.values(selectedCounts).reduce((sum, count) => sum + count, 0);
        if (prompts.length !== expectedTotal || prompts.some((prompt) => {
          const source = this.textures.get(this.greggTextureKey(prompt.textureId)).getSourceImage();
          const order = (orders.get(prompt.exerciseNumber) ?? 0) + 1;
          orders.set(prompt.exerciseNumber, order);
          const invalid = ids.has(prompt.id) || !prompt.answer.trim() || !prompt.crop
            || prompt.sequenceOrder !== order || !isValidGreggCrop(prompt.crop, source.width, source.height);
          ids.add(prompt.id);
          return invalid;
        }) || Object.entries(selectedCounts).some(([exercise, count]) => orders.get(Number(exercise)) !== count)) {
          this.showGreggUnavailable("Gregg pilot crop data is unavailable or invalid.");
          return;
        }
      }
      const prompt = prompts[this.greggIndex % prompts.length];
      this.greggIndex += 1;
      this.activeWord = prompt.answer;
      this.typedText = "";
      this.typedDisplay.setText(this.greggInputText("")).setColor("#ffff00");
      this.layoutGreggTarget(true);
      return;
    }
    const hasMultiplayerSequence = this.gameMode === "multiplayer" && this.multiplayerWordSequence.length > 0;
    if (!hasMultiplayerSequence && this.wordDeckIndex >= this.wordDeck.length && this.wordDeck.length > 0) {
      if (!this.isSoloSentence) this.wordDeck = this.shuffleWords(this.wordDeck, this.activeWord);
      this.wordDeckIndex = 0;
    }

    const sequence = hasMultiplayerSequence ? this.multiplayerWordSequence : this.wordDeck;
    const sequenceIndex = hasMultiplayerSequence
      ? this.multiplayerWordIndex++ % this.multiplayerWordSequence.length
      : this.wordDeckIndex++;
    const nextWord = sequence[sequenceIndex];

    if (!nextWord) {
      this.endMatch();
      return;
    }

    this.activeWord = nextWord;
    if (this.isSoloSentence) {
      this.typedText = "";
      this.typedDisplay.setText("").setColor("#ffff00");
      this.layoutSentenceTarget(true);
      return;
    }

    if (this.wordCategory === "stenography") {
      const prompt = getGreggPrompt(this.activeWord);
      if (!prompt) return;

      this.typedText = "";
      this.typedDisplay.setText("");
      this.wordY = 60;
      const lane = pickLaneNotSame(this.lastLane);
      this.lastLane = lane;
      this.wordX = getLaneX(this.scale.width, lane);
      this.wordTarget.setGreggImage(prompt.id, this.activeWord, this.wordX, this.wordY);
      return;
    }

    this.typedText = "";
    this.typedDisplay.setText("");
    this.typedDisplay.setColor("#ffff00");

    this.wordY = 60;

    const lane = pickLaneNotSame(this.lastLane);
    this.lastLane = lane;
    this.wordX = getLaneX(this.scale.width, lane);

    this.wordTarget.setWord(this.activeWord, this.wordX, this.wordY);
  }

  private shuffleWords(words: string[], avoidFirstWord = ""): string[] {
    const shuffled = [...new Set(words)];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Phaser.Math.Between(0, index);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    if (shuffled.length > 1 && shuffled[0] === avoidFirstWord) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    return shuffled;
  }

  private layoutSentenceInput(): void {
    const currentText = this.typedText;
    this.typedDisplay.setFontSize(this.scale.width < 480 ? 20 : 24)
      .setWordWrapWidth(Math.max(1, this.scale.width - 48), true).setOrigin(0.5, 0);
    let height = 0;
    for (const sentence of this.wordDeck) {
      this.typedDisplay.setText(sentence);
      height = Math.max(height, this.typedDisplay.height);
    }
    const top = this.scale.height - height - 16;
    this.typedDisplay.setText(currentText).setPosition(this.scale.width / 2, top);
    this.greggPlayBottom = top - 16;
  }

  private layoutSentenceTarget(resetPosition: boolean): void {
    this.wordX = this.scale.width / 2;
    this.wordTarget.setSentence(this.activeWord, this.wordX, this.wordY, Math.max(1, Math.min(760, this.scale.width - 48)));
    const top = this.greggPlayTop + this.wordTarget.height / 2;
    const bottom = this.greggPlayBottom - this.wordTarget.height / 2;
    if (this.scale.width < 240 || top >= bottom) {
      this.showGreggUnavailable("The game area is too small for sentence practice. Enlarge it and restart.");
      return;
    }
    this.wordY = resetPosition ? top : Phaser.Math.Clamp(this.wordY, top, bottom);
    this.wordTarget.setPosition(this.wordX, this.wordY);
  }

  private greggTextureKey(id: string): string {
    return `solo-gregg-${id}`;
  }

  private greggTargets() {
    if (import.meta.env.DEV && this.isGreggCropPilot) {
      return [...PENDING_GREGG_PILOT_MAPPINGS]
        .filter((item) => !("playable" in item && item.playable === false))
        .filter((item) => this.greggPilotExercise === null || item.exerciseNumber === this.greggPilotExercise)
        .sort((a, b) => a.exerciseNumber - b.exerciseNumber || a.sequenceOrder - b.sequenceOrder)
        .map((item) => ({ ...item, textureId: `steno-${item.exerciseNumber}` }));
    }
    return getSoloGreggPrompts().map((item) => ({ ...item, textureId: item.id,
      crop: undefined, sequenceOrder: undefined }));
  }

  private showGreggUnavailable(message: string): void {
    this.gameOver = true;
    this.wordTarget.hide();
    this.gameOverDisplay.setFontSize(18).setWordWrapWidth(Math.max(1, this.scale.width - 64), true)
      .setText(message).setVisible(true);
  }

  private layoutGreggInput(): void {
    const width = Math.max(1, this.scale.width - 48);
    const currentText = this.typedText;
    this.typedDisplay.setFontSize(this.scale.width < 480 ? 20 : 24)
      .setWordWrapWidth(width, true).setOrigin(0.5, 0);
    if (this.isGreggCropPilot) this.typedDisplay.setBackgroundColor("#102441");
    // Reserve enough space for any sentence so the falling boundary does not move while typing.
    let maxHeight = 0;
    for (const prompt of this.greggTargets()) {
      this.typedDisplay.setText(this.greggInputText(prompt.answer));
      maxHeight = Math.max(maxHeight, this.typedDisplay.height);
    }
    const inputTop = this.scale.height - maxHeight - 16;
    this.typedDisplay.setText(this.greggInputText(currentText)).setPosition(this.scale.width / 2, inputTop);
    this.greggPlayBottom = inputTop - 16;
  }

  private greggInputText(text: string): string {
    return this.isGreggCropPilot ? `Type: ${text || "…"}` : text;
  }

  private layoutGreggTarget(resetPosition: boolean): void {
    const prompts = this.greggTargets();
    const prompt = this.isGreggCropPilot ? prompts[(this.greggIndex - 1) % prompts.length]
      : prompts.find((item) => item.answer === this.activeWord);
    if (!prompt) return;
    const availableHeight = this.greggPlayBottom - this.greggPlayTop;
    if (availableHeight < 160 || this.scale.width < 240) {
      this.showGreggUnavailable("The game area is too small for Gregg exercises. Enlarge it and restart.");
      return;
    }
    this.wordX = this.scale.width / 2;
    const textureKey = this.greggTextureKey(prompt.textureId);
    const width = Math.min(350, this.scale.width - 32);
    const maxHeight = Math.min(260, availableHeight * 0.65);
    const fits = this.isGreggCropPilot && prompt.crop
      ? this.wordTarget.setSoloGreggCrop(textureKey, prompt.answer, prompt.crop, this.wordX, this.wordY, width, maxHeight)
      : this.wordTarget.setSoloGreggImage(textureKey, prompt.answer, this.wordX, this.wordY, width, maxHeight);
    if (!fits) {
      this.showGreggUnavailable("The game area is too small for Gregg exercises. Enlarge it and restart.");
      return;
    }
    if (this.isGreggCropPilot) {
      if (resetPosition) this.lastLane = pickLaneNotSame(this.lastLane);
      // Use rendered content width, including border clearance and the 3px shadow.
      const halfWidth = this.wordTarget.width / 2;
      this.wordX = Phaser.Math.Clamp(getLaneX(this.scale.width, this.lastLane),
        16 + halfWidth, this.scale.width - 19 - halfWidth);
    }
    const top = this.greggPlayTop + this.wordTarget.height / 2;
    const bottom = this.greggPlayBottom - this.wordTarget.height / 2;
    if (top >= bottom) {
      this.showGreggUnavailable("The game area is too small for Gregg exercises. Enlarge it and restart.");
      return;
    }
    this.wordY = resetPosition ? top : Phaser.Math.Clamp(this.wordY, top, bottom);
    this.wordTarget.setPosition(this.wordX, this.wordY);
  }

  private handleTyping(key: string): void {
    if (this.pauseMenu.isPaused || this.gameOver) return;

    if (key === "Backspace") {
      if (this.typedText.length > 0) {
        this.typedText = this.typedText.slice(0, -1);
        this.typedDisplay.setText(this.greggInputText(this.typedText));
        this.refreshWordSplit();
      }
      return;
    }

    const specialKeys = [
      "Shift",
      "Control",
      "Alt",
      "Meta",
      "CapsLock",
      "Tab",
      "Enter",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ];
    if (specialKeys.includes(key)) return;
    if (key.length !== 1) return;

    this.waterEffects.shoot(this.typedDisplay.x, this.typedDisplay.y - 8, this.wordX, this.wordY);

    this.typedText += key;
    this.typedDisplay.setText(this.greggInputText(this.typedText));

    if (this.activeWord.toLowerCase().startsWith(this.typedText.toLowerCase())) {
      this.correctKeystrokes += 1;
      this.typedDisplay.setColor("#00ff00");
      this.refreshWordSplit();

      if (this.typedText.toLowerCase() === this.activeWord.toLowerCase()) {
        this.waterEffects.playSplash(this.wordX, this.wordY, 22);

        this.score += 10;
        this.completedWords += 1;
        this.completedCharacters += this.activeWord.length;
        this.updateHud();
        this.spawnWord();
      }
    } else {
      this.onWrongKey();
    }
  }

  private refreshWordSplit(): void {
    this.wordTarget.setTypedText(this.typedText);

    if (this.typedText.length === 0) {
      this.typedDisplay.setColor("#ffff00");
    }
  }

  private onWrongKey(): void {
    this.incorrectKeystrokes += 1;
    this.score -= 2;
    this.updateHud();

    this.cameras.main.shake(80, 0.003);

    if (this.isSoloGregg || this.isSoloSentence) {
      this.typedText = this.typedText.slice(0, -1);
      this.typedDisplay.setText(this.greggInputText(this.typedText)).setColor("#ff665f");
      return;
    }

    this.typedText = "";
    this.typedDisplay.setText("");
    this.typedDisplay.setColor("#ffff00");
    this.wordTarget.resetToFullWord();
  }

  private onMissBottom(): void {
    this.lives = Math.max(0, this.lives - 1);
    this.score -= 5;
    if (this.lives === 0) {
      this.endReason = "health";
      this.updateHud();
      this.endMatch();
      return;
    }

    this.updateHud();

    this.cameras.main.shake(120, 0.004);
    this.spawnWord();
  }

  private updateHud(): void {
    const elapsedMinutes = this.elapsedSeconds / 60;
    const wpm = elapsedMinutes > 0 ? this.completedCharacters / 5 / elapsedMinutes : 0;
    const totalKeystrokes = this.correctKeystrokes + this.incorrectKeystrokes;
    const accuracy = totalKeystrokes > 0 ? (this.correctKeystrokes / totalKeystrokes) * 100 : 0;
    const errorRate = totalKeystrokes > 0 ? (this.incorrectKeystrokes / totalKeystrokes) * 100 : 0;

    const topValues = [String(this.lives), String(this.score), `${Math.ceil(this.remainingSeconds)}s`];
    this.topHudMetrics.forEach(({ value }, index) => value.setText(topValues[index]));

    const sideValues = [
      wpm.toFixed(1),
      `${accuracy.toFixed(1)}%`,
      `${errorRate.toFixed(1)}%`,
      this.difficultyKey.toUpperCase(),
    ];
    this.hudMetrics.forEach(({ value }, index) => value.setText(sideValues[index]));
  }

  private layoutHud(): void {
    if (this.isSoloGregg || this.isSoloSentence) {
      this.topHudPanel.setPosition(0, 0).setSize(this.scale.width, 58);
      const topCellWidth = Math.max(0, this.scale.width - 112) / this.topHudMetrics.length;
      this.topHudMetrics.forEach(({ label, value }, index) => {
        label.setPosition(12 + index * topCellWidth, 7);
        value.setPosition(12 + index * topCellWidth, 27);
      });
      const cellWidth = Math.max(1, (this.scale.width - 24) / this.hudMetrics.length);
      this.hudPanel.setPosition(12, 72).setSize(this.scale.width - 24, 60);
      this.hudMetrics.forEach(({ label, value }, index) => {
        label.setFontSize(this.scale.width < 480 ? 10 : 14).setPosition(20 + index * cellWidth, 79);
        value.setFontSize(this.scale.width < 480 ? 16 : 22).setPosition(20 + index * cellWidth, 101);
      });
      this.hudDividers.forEach((divider) => divider.setVisible(false));
      return;
    }
    const left = 12;
    const top = 72;
    const width = Math.min(156, Math.max(126, this.scale.width * 0.24));
    const rowHeight = Math.min(58, (this.scale.height - 24) / this.hudMetrics.length);
    this.topHudPanel.setPosition(0, 0).setSize(this.scale.width, 58);
    const availableTopWidth = Math.max(0, this.scale.width - 144);
    const topCellWidth = availableTopWidth / this.topHudMetrics.length;
    this.topHudMetrics.forEach(({ label, value }, index) => {
      const cellLeft = 18 + index * topCellWidth;
      label.setPosition(cellLeft, 7);
      value.setPosition(cellLeft, 27);
    });
    this.hudPanel.setPosition(left, top).setSize(width, rowHeight * this.hudMetrics.length);

    this.hudMetrics.forEach(({ label, value }, index) => {
      const rowTop = top + index * rowHeight;
      label.setPosition(left + 12, rowTop + 7);
      value.setPosition(left + 12, rowTop + 26);
      if (index > 0) {
        this.hudDividers[index - 1].setPosition(left, rowTop).setSize(width, 1);
      }
    });
  }

  private reportPerformance(force = false): void {
    if (this.gameMode !== "multiplayer" || !this.onPerformance) return;
    if (!force && Math.floor(this.elapsedSeconds) <= this.lastPerformanceReportSecond) return;
    this.lastPerformanceReportSecond = Math.floor(this.elapsedSeconds);

    const elapsedMinutes = this.elapsedSeconds / 60;
    const totalKeystrokes = this.correctKeystrokes + this.incorrectKeystrokes;
    this.onPerformance({
      score: this.score,
      wpm: elapsedMinutes > 0 ? this.completedCharacters / 5 / elapsedMinutes : 0,
      accuracy: totalKeystrokes > 0 ? (this.correctKeystrokes / totalKeystrokes) * 100 : 0,
      lives: this.lives,
      completedWords: this.completedWords,
      finished: this.gameOver,
    });
  }

  private endMatch(): void {
    this.gameOver = true;
    this.reportPerformance(true);
    const elapsedMinutes = this.elapsedSeconds / 60;
    const wpm = elapsedMinutes > 0 ? this.completedCharacters / 5 / elapsedMinutes : 0;
    const totalKeystrokes = this.correctKeystrokes + this.incorrectKeystrokes;
    const accuracy = totalKeystrokes > 0 ? (this.correctKeystrokes / totalKeystrokes) * 100 : 0;
    const errorRate = totalKeystrokes > 0 ? (this.incorrectKeystrokes / totalKeystrokes) * 100 : 0;

    this.onGameOver({
      score: this.score,
      wpm,
      accuracy,
      errorRate,
      completedWords: this.completedWords,
      remainingLives: this.lives,
      endReason: this.endReason,
      mode: this.matchConfig.mode,
      difficulty: this.matchConfig.difficulty,
      roundTime: this.matchConfig.roundTime,
      wordSet: this.matchConfig.wordSet,
      ...(this.isSoloGregg ? { greggSubmode: this.isGreggCropPilot ? "word-phrase" as const : "full-sentence" as const } : {}),
      ...(!this.isSoloGregg && this.gameMode === "solo" ? { practiceFormat: this.isSoloSentence ? "full-sentence" as const : "word-phrase" as const } : {}),
    });

    const completionMessage = this.gameMode === "multiplayer" ? "\nWaiting for other players..." : "";
    this.gameOverDisplay
      .setText(
        `GAME OVER\n\nReason: ${this.endReason === "health" ? "Health depleted" : "Time expired"}\nScore: ${this.score}\nWPM: ${wpm.toFixed(1)}\nAccuracy: ${accuracy.toFixed(1)}%\nError Rate: ${errorRate.toFixed(1)}%\nCompleted ${this.isSoloSentence ? "sentences" : "words"}: ${this.completedWords}\nLives: ${this.lives}${completionMessage}`,
      )
      .setVisible(true);
  }

  private getDifficultyKey(difficulty: string): keyof typeof GameScene.DIFFICULTY_CONFIG {
    const normalizedDifficulty = difficulty.toLowerCase();
    if (normalizedDifficulty === "easy" || normalizedDifficulty === "hard" || normalizedDifficulty === "extreme") {
      return normalizedDifficulty === "easy" ? "easy" : "hard";
    }
    return "normal";
  }
}
