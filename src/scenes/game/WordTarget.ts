import Phaser from "phaser";
import { isValidGreggCrop, type GreggCropRectangle } from "../../data/greggCropMappings";

type WordTargetOptions = {
  wordFontSize: number;
  tileHeight: number;
  tilePaddingX: number;
};

export class WordTarget {
  private readonly scene: Phaser.Scene;
  private readonly tileHeight: number;
  private readonly tilePaddingX: number;
  private readonly shadowOffset = 3;

  private readonly wordShadow: Phaser.GameObjects.Rectangle;
  private readonly wordBlock: Phaser.GameObjects.Rectangle;
  private readonly wordTextTyped: Phaser.GameObjects.Text;
  private readonly wordTextRemaining: Phaser.GameObjects.Text;
  private wordImage?: Phaser.GameObjects.Image;
  private cropBackground?: Phaser.GameObjects.Rectangle;
  private isImagePrompt = false;
  private isSentencePrompt = false;
  private greggReference?: Phaser.GameObjects.Text;
  private greggImageOffset = 0;
  private greggReferenceOffset = 0;

  private activeWord = "";

  constructor(scene: Phaser.Scene, options: WordTargetOptions) {
    this.scene = scene;
    this.tileHeight = options.tileHeight;
    this.tilePaddingX = options.tilePaddingX;

    this.wordShadow = this.scene.add.rectangle(0, 60, 180, this.tileHeight, 0x000000, 0.38);
    this.wordShadow.setDepth(1);

    this.wordBlock = this.scene.add.rectangle(0, 60, 180, this.tileHeight, 0x222222, 1.0);
    this.wordBlock.setStrokeStyle(2, 0x00ff66, 1.0);
    this.wordBlock.setDepth(2);

    this.wordTextTyped = this.scene.add
      .text(0, 60, "", {
        fontFamily: "monospace",
        fontSize: `${options.wordFontSize}px`,
        color: "#00ff00",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5)
      .setDepth(3);

    this.wordTextRemaining = this.scene.add
      .text(0, 60, "", {
        fontFamily: "monospace",
        fontSize: `${options.wordFontSize}px`,
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5)
      .setDepth(3);
  }

  setWord(word: string, x: number, y: number): void {
    this.isSentencePrompt = false;
    this.activeWord = word;
    this.isImagePrompt = false;
    this.wordImage?.setVisible(false);
    this.cropBackground?.setVisible(false);
    this.greggReference?.setVisible(false);

    this.wordTextTyped.setText("");
    this.wordTextTyped.setVisible(true);
    this.wordTextRemaining.setVisible(true);
    this.wordTextRemaining.setText(word);

    const textWidth = this.wordTextRemaining.width;
    const textHeight = this.wordTextRemaining.height;
    const blockWidth = Math.max(150, Math.ceil(textWidth + this.tilePaddingX));
    const blockHeight = Math.max(this.tileHeight, Math.ceil(textHeight + 20));

    this.wordBlock.setSize(blockWidth, blockHeight);
    this.wordShadow.setSize(blockWidth, blockHeight);

    this.setPosition(x, y);
  }

  setSentence(sentence: string, x: number, y: number, maxWidth: number): void {
    this.setWord(sentence, x, y);
    this.isSentencePrompt = true;
    this.wordTextTyped.setVisible(false);
    this.wordTextRemaining.setFontSize(maxWidth < 400 ? 16 : 20)
      .setWordWrapWidth(Math.max(1, maxWidth - 32), true).setText(sentence);
    const width = Math.min(maxWidth, this.wordTextRemaining.width + 32);
    const height = Math.max(this.tileHeight, this.wordTextRemaining.height + 24);
    this.wordBlock.setSize(width, height);
    this.wordShadow.setSize(width, height);
    this.setPosition(x, y);
  }

  setGreggImage(textureKey: string, answer: string, x: number, y: number, frameName?: string): void {
    this.cropBackground?.setVisible(false);
    this.greggReference?.setVisible(false);
    this.activeWord = answer;
    this.isImagePrompt = true;
    this.wordTextTyped.setText("").setVisible(false);
    this.wordTextRemaining.setText("").setVisible(false);

    if (!this.wordImage) {
      this.wordImage = this.scene.add.image(0, 60, textureKey, frameName).setOrigin(0.5).setDepth(3);
    } else {
      this.wordImage.setTexture(textureKey, frameName).setVisible(true);
    }

    this.wordImage.setDisplaySize(120, 40);
    this.wordBlock.setSize(180, this.tileHeight);
    this.wordShadow.setSize(180, this.tileHeight);
    this.setPosition(x, y);
  }

  // Used exclusively by Solo Gregg; the legacy image and ordinary word layouts remain unchanged.
  setSoloGreggImage(textureKey: string, answer: string, x: number, y: number, width: number, maxHeight: number, frameName?: string): boolean {
    this.setGreggImage(textureKey, answer, x, y, frameName);
    if (!this.greggReference) {
      this.greggReference = this.scene.add.text(0, 0, "", {
        fontFamily: "Arial", fontSize: "14px", color: "#dcecff", align: "center",
      }).setOrigin(0.5, 0).setDepth(3);
    }
    const padding = 12;
    const contentWidth = Math.max(1, width - padding * 2);
    this.greggReference.setFontSize(14)
      .setWordWrapWidth(contentWidth, true).setText(answer).setVisible(true);
    const image = this.wordImage!;
    // Frame dimensions reflect the current texture, including differently cropped PNGs.
    const sourceWidth = image.frame.realWidth;
    const sourceHeight = image.frame.realHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return false;
    const imageHeight = maxHeight - this.greggReference.height - padding * 3;
    if (imageHeight < 40) return false;
    const scale = Math.min(contentWidth / sourceWidth, imageHeight / sourceHeight);
    image.setScale(scale);
    // A height-constrained portrait image should not leave an oversized background.
    const tileWidth = Math.min(width, Math.max(image.displayWidth, this.greggReference.width) + padding * 2);
    const height = image.displayHeight + this.greggReference.height + padding * 3;
    this.wordBlock.setSize(tileWidth, height);
    this.wordShadow.setSize(tileWidth, height);
    this.greggImageOffset = -height / 2 + padding + image.displayHeight / 2;
    this.greggReferenceOffset = -height / 2 + padding * 2 + image.displayHeight;
    this.setPosition(x, y);
    return true;
  }

  // Compact crop layout, currently used only by the development pilot.
  setSoloGreggCrop(textureKey: string, answer: string, crop: GreggCropRectangle,
    x: number, y: number, width: number, maxHeight: number): boolean {
    if (!this.scene.textures.exists(textureKey)) return false;
    const texture = this.scene.textures.get(textureKey);
    const source = texture.getSourceImage();
    if (!isValidGreggCrop(crop, source.width, source.height)) return false;
    // A virtual frame selects source pixels without generating files or changing the PNG.
    // Include dimensions so distinct crops never reuse a different region's frame.
    const frameName = `gregg-crop-${crop.x}-${crop.y}-${crop.width}-${crop.height}`;
    if (!texture.has(frameName)
      && !texture.add(frameName, 0, crop.x, crop.y, crop.width, crop.height)) return false;
    this.setGreggImage(textureKey, answer, x, y, frameName);
    if (!this.greggReference) {
      this.greggReference = this.scene.add.text(0, 0, "", {
        fontFamily: "Arial", fontSize: "14px", color: "#dcecff", align: "center",
      }).setOrigin(0.5, 0).setDepth(3);
    }
    const padding = 6;
    const gap = 4;
    const contentWidth = Math.min(130, width - padding * 2);
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) return false;
    this.greggReference.setFontSize(14).setWordWrapWidth(contentWidth, true).setText(answer).setVisible(true);
    const imageHeight = Math.min(75, maxHeight - this.greggReference.height - padding * 2 - gap);
    if (!Number.isFinite(imageHeight) || imageHeight <= 0) return false;
    const scale = Math.min(1, contentWidth / crop.width, imageHeight / crop.height);
    const image = this.wordImage!;
    image.setScale(scale);
    const tileWidth = Math.max(image.displayWidth, this.greggReference.width) + padding * 2;
    const tileHeight = image.displayHeight + this.greggReference.height + padding * 2 + gap;
    this.wordBlock.setSize(tileWidth, tileHeight);
    this.wordShadow.setSize(tileWidth, tileHeight);
    this.greggImageOffset = -tileHeight / 2 + padding + image.displayHeight / 2;
    this.greggReferenceOffset = -tileHeight / 2 + padding + image.displayHeight + gap;
    if (!this.cropBackground) {
      this.cropBackground = this.scene.add.rectangle(0, 0, 1, 1, 0xffffff).setDepth(2.5);
    }
    this.cropBackground.setSize(image.displayWidth, image.displayHeight).setVisible(true);
    this.setPosition(x, y);
    return true;
  }

  hide(): void {
    this.wordBlock.setVisible(false);
    this.wordShadow.setVisible(false);
    this.wordImage?.setVisible(false);
    this.cropBackground?.setVisible(false);
    this.greggReference?.setVisible(false);
    this.wordTextTyped.setVisible(false);
    this.wordTextRemaining.setVisible(false);
  }

  get height(): number {
    return this.wordBlock.height;
  }

  get width(): number {
    return this.wordBlock.width;
  }

  setTypedText(typedText: string): void {
    if (this.isImagePrompt || this.isSentencePrompt) return;

    const typedPart = this.activeWord.substring(0, typedText.length);
    const remainingPart = this.activeWord.substring(typedText.length);

    this.wordTextTyped.setText(typedPart);
    this.wordTextRemaining.setText(remainingPart);

    this.layoutWordParts(this.wordBlock.x, this.wordBlock.y);
  }

  resetToFullWord(): void {
    if (this.isImagePrompt || this.isSentencePrompt) return;

    this.wordTextTyped.setText("");
    this.wordTextRemaining.setText(this.activeWord);
    this.layoutWordParts(this.wordBlock.x, this.wordBlock.y);
  }

  setPosition(x: number, y: number): void {
    const snappedX = Math.round(x);
    const snappedY = Math.round(y);

    this.wordBlock.setPosition(snappedX, snappedY);
    this.wordShadow.setPosition(snappedX + this.shadowOffset, snappedY + this.shadowOffset);
    this.wordImage?.setPosition(snappedX, snappedY);
    if (this.greggReference?.visible) {
      this.wordImage?.setPosition(snappedX, snappedY + this.greggImageOffset);
      this.cropBackground?.setPosition(snappedX, snappedY + this.greggImageOffset);
      this.greggReference.setPosition(snappedX, snappedY + this.greggReferenceOffset);
    }
    this.layoutWordParts(snappedX, snappedY);
  }

  private layoutWordParts(x: number, y: number): void {
    const typedWidth = this.wordTextTyped.width;
    const remainingWidth = this.wordTextRemaining.width;
    const totalWidth = typedWidth + remainingWidth;

    const startX = x - totalWidth / 2;

    this.wordTextTyped.setPosition(startX, y);
    this.wordTextRemaining.setPosition(startX + typedWidth, y);
  }
}
