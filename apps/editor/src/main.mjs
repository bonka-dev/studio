import { openBrowserProject, saveBrowserProject, closeBrowserProject } from "./io/browser-project-loader.mjs";
import { allocateEntityId, applyEditorState, projectToEditorState } from "./project/editor-project.mjs";

globalThis.BonkaProject = Object.freeze({
    allocateEntityId,
    applyEditorState,
    closeBrowserProject,
    openBrowserProject,
    projectToEditorState,
    saveBrowserProject,
});
