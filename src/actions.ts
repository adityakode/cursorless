import {
  commands,
  Range,
  Selection,
  TextEditor,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import update from "immutability-helper";
import EditStyles from "./editStyles";
import { ActionPreferences, TypedSelection } from "./Types";
import { promisify } from "util";
import { isLineSelectionType } from "./selectionType";
import { groupBy } from "./itertools";
import { flatten } from "lodash";

const sleep = promisify(setTimeout);

async function decorationSleep() {
  const pendingEditDecorationTime = workspace
    .getConfiguration("cursorless")
    .get<number>("pendingEditDecorationTime")!;

  await sleep(pendingEditDecorationTime);
}

interface Action {
  (targets: TypedSelection[][], ...args: any[]): Promise<any>;
}

const columnFocusCommands = {
  [ViewColumn.One]: "workbench.action.focusFirstEditorGroup",
  [ViewColumn.Two]: "workbench.action.focusSecondEditorGroup",
  [ViewColumn.Three]: "workbench.action.focusThirdEditorGroup",
  [ViewColumn.Four]: "workbench.action.focusFourthEditorGroup",
  [ViewColumn.Five]: "workbench.action.focusFifthEditorGroup",
  [ViewColumn.Six]: "workbench.action.focusSixthEditorGroup",
  [ViewColumn.Seven]: "workbench.action.focusSeventhEditorGroup",
  [ViewColumn.Eight]: "workbench.action.focusEighthEditorGroup",
  [ViewColumn.Nine]: "workbench.action.focusNinthEditorGroup",
  [ViewColumn.Active]: "",
  [ViewColumn.Beside]: "",
};

function getSingleEditor(targets: TypedSelection[]) {
  const editors = targets.map((target) => target.selection.editor);

  if (new Set(editors).size > 1) {
    throw new Error("Can only select from one document at a time");
  }

  return editors[0];
}

async function runForEachEditor(
  targets: TypedSelection[],
  func: (editor: TextEditor, selections: TypedSelection[]) => Promise<any>
) {
  return await Promise.all(
    Array.from(
      groupBy(targets, (target) => target.selection.editor),
      async ([editor, selections]) => func(editor, selections)
    )
  );
}

export const targetPreferences: Record<keyof Actions, ActionPreferences[]> = {
  clear: [{ insideOutsideType: "inside" }],
  delete: [{ insideOutsideType: "outside" }],
  paste: [{ position: "after", insideOutsideType: "outside" }],
  setSelection: [{ insideOutsideType: "inside" }],
  setSelectionAfter: [{ insideOutsideType: "inside" }],
  setSelectionBefore: [{ insideOutsideType: "inside" }],
  wrapWithFunction: [{ insideOutsideType: "inside" }],
};

class Actions {
  constructor(private styles: EditStyles) {
    this.clear = this.clear.bind(this);
    this.delete = this.delete.bind(this);
    this.paste = this.paste.bind(this);
    this.setSelection = this.setSelection.bind(this);
    this.setSelectionAfter = this.setSelectionAfter.bind(this);
    this.setSelectionBefore = this.setSelectionBefore.bind(this);
    this.wrapWithFunction = this.wrapWithFunction.bind(this);
  }

  setSelection: Action = async ([targets]) => {
    const editor = getSingleEditor(targets);

    if (editor.viewColumn != null) {
      await commands.executeCommand(columnFocusCommands[editor.viewColumn]);
    }
    editor.selections = targets.map((target) => target.selection.selection);
    editor.revealRange(editor.selections[0]);
  };

  setSelectionBefore: Action = async ([targets]) => {
    this.setSelection([
      targets.map((target) =>
        update(target, {
          selection: {
            selection: {
              $apply: (selection) =>
                new Selection(selection.start, selection.start),
            },
          },
        })
      ),
    ]);
  };

  setSelectionAfter: Action = async ([targets]) => {
    this.setSelection([
      targets.map((target) =>
        update(target, {
          selection: {
            selection: {
              $apply: (selection) =>
                new Selection(selection.end, selection.end),
            },
          },
        })
      ),
    ]);
  };

  delete: Action = async ([targets]) => {
    await runForEachEditor(targets, async (editor, selections) => {
      editor.setDecorations(
        this.styles.pendingDelete,
        selections
          .filter((selection) => !isLineSelectionType(selection.selectionType))
          .map((selection) => selection.selection.selection)
      );

      editor.setDecorations(
        this.styles.pendingLineDelete,
        selections
          .filter((selection) => isLineSelectionType(selection.selectionType))
          .map((selection) =>
            selection.selection.selection.with(
              undefined,
              // NB: We move end up one line because it is at beginning of
              // next line
              selection.selection.selection.end.translate(-1)
            )
          )
      );

      await decorationSleep();

      editor.setDecorations(this.styles.pendingDelete, []);
      editor.setDecorations(this.styles.pendingLineDelete, []);

      await editor.edit((editBuilder) => {
        selections.forEach((selection) => {
          // TODO Properly handle last line of file
          editBuilder.delete(selection.selection.selection);
        });
      });
    });
  };

  clear: Action = async ([targets]) => {
    await this.setSelection([targets]);
    await commands.executeCommand("deleteLeft");
  };

  paste: Action = async ([targets]) => {
    throw new Error("Not implemented");
  };

  wrapWithFunction: Action = async ([targets], functionName: string) => {
    await runForEachEditor(targets, async (editor, selections) => {
      await editor.edit((editBuilder) => {
        selections.forEach((selection) => {
          editBuilder.insert(
            selection.selection.selection.start,
            `${functionName}(`
          );
          editBuilder.insert(selection.selection.selection.end, ")");
        });
      });

      editor.setDecorations(
        this.styles.justAdded,
        flatten(
          selections.map((selection) => [
            new Range(
              selection.selection.selection.start,
              selection.selection.selection.start.translate(
                undefined,
                functionName.length + 1
              )
            ),
            new Range(
              selection.selection.selection.end.translate(
                undefined,
                functionName.length + 1
              ),
              selection.selection.selection.end.translate(
                undefined,
                functionName.length + 2
              )
            ),
          ])
        )
      );

      await decorationSleep();

      editor.setDecorations(this.styles.justAdded, []);
    });
  };
}

export default Actions;
