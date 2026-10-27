import Phaser from "phaser";
import { PLAYER_RADIUS, Y_SCALE, questDefById, type QuestKind } from "@raid/shared";
import { questAccepted, questItemQuestId, questKindColor, questTurnIn, visibleQuest, type QuestCollection, type QuestContainerCollection, type QuestPosition, type QuestStateLike } from "../ui/questModel";
import { BODY_LIFT, depthFor, projX, projY } from "./projection";

interface QuestPlayer {
  x: number;
  y: number;
  status: string;
}

export interface QuestViewFrame {
  quests: QuestCollection;
  containers: QuestContainerCollection;
  players: { get(id: string): QuestPlayer | undefined };
  positions: ReadonlyMap<string, QuestPosition>;
  localId: string;
  me?: QuestPlayer;
  highlightId?: string;
}

interface GiverView {
  root: Phaser.GameObjects.Container;
  offer: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
  /** The mark now drawn: "!" for an offer the local player has not accepted, "?" for one they hold. */
  accepted: boolean | null;
}

interface ItemView {
  root: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

const LABEL_STYLE = { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#eceff1", stroke: "#000000", strokeThickness: 3 };

export class QuestView {
  private readonly givers = new Map<string, GiverView>();
  private readonly items = new Map<string, ItemView>();
  private readonly carriers = new Map<string, Phaser.GameObjects.Container>();

  constructor(private readonly scene: Phaser.Scene) {}

  update(frame: QuestViewFrame): void {
    const seenGivers = new Set<string>();
    const carrierIds = new Set<string>();
    frame.quests.forEach((quest) => {
      if (!visibleQuest(quest) || quest.status !== "open") return;
      const def = questDefById(quest.def);
      if (!def) return;
      seenGivers.add(quest.id);
      const giver = this.givers.get(quest.id) ?? this.makeGiver(quest, def.giver, def.kind);
      this.givers.set(quest.id, giver);
      giver.offer.setVisible(true);
      // An offer not yet accepted is a bright "!" (a call to action: F at the giver); one held is a dim "?" (a job in hand).
      const accepted = questAccepted(quest, frame.localId);
      if (giver.accepted !== accepted) {
        giver.accepted = accepted;
        giver.offer.setText(accepted ? "?" : "!").setAlpha(accepted ? 0.6 : 1);
      }
      giver.hint.setVisible(frame.me?.status === "alive" && questTurnIn(quest, def, frame.localId, frame.me));
      if (quest.carrier) {
        const at = frame.positions.get(quest.carrier) ?? frame.players.get(quest.carrier);
        if (at) {
          carrierIds.add(quest.id);
          const marker = this.carriers.get(quest.id) ?? this.makeCarrier(def.kind);
          this.carriers.set(quest.id, marker);
          marker.setPosition(projX(at.x), projY(at.y)).setDepth(depthFor(at.y, PLAYER_RADIUS + 50));
        }
      }
    });
    for (const [id, view] of this.givers) {
      if (!seenGivers.has(id)) { view.root.destroy(); this.givers.delete(id); }
    }
    for (const [id, view] of this.carriers) {
      if (!carrierIds.has(id)) { view.destroy(); this.carriers.delete(id); }
    }

    const seenItems = new Set<string>();
    frame.containers.forEach((container) => {
      const questId = questItemQuestId(container);
      if (!questId) return;
      const quest = this.questById(frame.quests, questId);
      if (!quest || !visibleQuest(quest) || quest.status !== "open") return;
      const def = questDefById(quest.def);
      if (!def) return;
      seenItems.add(container.id);
      const item = this.items.get(container.id) ?? this.makeItem(container.x, container.y, container.label, def.kind);
      this.items.set(container.id, item);
      item.label.setVisible(frame.highlightId === container.id);
    });
    for (const [id, view] of this.items) {
      if (!seenItems.has(id)) { view.root.destroy(); this.items.delete(id); }
    }
  }

  destroy(): void {
    for (const view of this.givers.values()) view.root.destroy();
    for (const view of this.items.values()) view.root.destroy();
    for (const view of this.carriers.values()) view.destroy();
    this.givers.clear();
    this.items.clear();
    this.carriers.clear();
  }

  private questById(quests: QuestCollection, id: string): QuestStateLike | undefined {
    let found: QuestStateLike | undefined;
    quests.forEach((quest, key) => { if (key === id || quest.id === id) found = quest; });
    return found;
  }

  private makeGiver(quest: QuestStateLike, name: string, kind: QuestKind): GiverView {
    const color = questKindColor(kind);
    const shape = this.scene.add.graphics();
    shape.fillStyle(0x000000, 0.3).fillEllipse(0, 1, 34, 14);
    shape.fillStyle(color, 0.22).fillEllipse(0, 0, 30, 13);
    shape.lineStyle(2, color, 1);
    shape.beginPath();
    shape.moveTo(0, -BODY_LIFT - 15);
    shape.lineTo(12, -BODY_LIFT);
    shape.lineTo(0, -BODY_LIFT + 15);
    shape.lineTo(-12, -BODY_LIFT);
    shape.closePath();
    shape.fillStyle(color, 1).fillPath().strokePath();
    shape.lineBetween(0, -BODY_LIFT + 15, 0, 0);
    const label = this.scene.add.text(0, -BODY_LIFT - 42, name, LABEL_STYLE).setOrigin(0.5, 1);
    const offer = this.scene.add.text(0, -BODY_LIFT - 60, "!", {
      ...LABEL_STYLE, fontSize: "22px", fontStyle: "bold", color: `#${color.toString(16).padStart(6, "0")}`,
    }).setOrigin(0.5, 1);
    const hint = this.scene.add.text(0, 16, "Turn in here", {
      ...LABEL_STYLE, fontSize: "12px", fontStyle: "bold", color: "#fff59d",
    }).setOrigin(0.5, 0).setVisible(false);
    const root = this.scene.add.container(projX(quest.x), projY(quest.y), [shape, label, offer, hint]).setDepth(depthFor(quest.y));
    return { root, offer, hint, accepted: null };
  }

  private makeItem(x: number, y: number, text: string, kind: QuestKind): ItemView {
    const color = questKindColor(kind);
    const shape = this.scene.add.graphics();
    shape.fillStyle(0x000000, 0.3).fillEllipse(0, 1, 20, 8);
    shape.fillStyle(color, 0.22).fillEllipse(0, 0, 22, 10);
    shape.lineStyle(1.5, color, 1).fillStyle(color, 1);
    if (kind === "fetch") {
      shape.fillRect(-6, -13, 12, 10).strokeRect(-6, -13, 12, 10);
      shape.lineBetween(-3, -13, -3, -16).lineBetween(-3, -16, 5, -16).lineBetween(5, -16, 5, -12);
    } else {
      shape.beginPath();
      shape.moveTo(0, -17).lineTo(6, -8).lineTo(0, -2).lineTo(-6, -8).closePath();
      shape.fillPath().strokePath();
    }
    const label = this.scene.add.text(0, -24, text, LABEL_STYLE).setOrigin(0.5, 1).setVisible(false);
    const root = this.scene.add.container(projX(x), projY(y), [shape, label]).setDepth(depthFor(y, -PLAYER_RADIUS));
    return { root, label };
  }

  private makeCarrier(kind: QuestKind): Phaser.GameObjects.Container {
    const color = questKindColor(kind);
    const shape = this.scene.add.graphics();
    shape.fillStyle(color, 1).lineStyle(2, 0x101318, 1);
    shape.fillRect(-7, -BODY_LIFT - 48, 14, 12).strokeRect(-7, -BODY_LIFT - 48, 14, 12);
    shape.lineStyle(2, color, 0.8).strokeEllipse(0, 0, 30 * Y_SCALE, 30 * Y_SCALE);
    return this.scene.add.container(0, 0, [shape]);
  }
}
