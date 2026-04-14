/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License", destination); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as path from 'path';
import { ActivityBar, BottomBarPanel, By, DebugToolbar, EditorView, error, ExtensionsViewItem, ExtensionsViewSection, InputBox, ModalDialog, TextEditor, until, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';
import * as fs from 'fs-extra';
import { DEBUGGER_ATTACHED_MESSAGE } from './variables';

function normalizeExtensionTitle(title: string): string {
    return title
        .replaceAll(/\(\s*preview\s*\)/gi, '')
        .replaceAll(/\[\s*preview\s*\]/gi, '')
        .replaceAll(/\bpreview\b/gi, '')
        .replaceAll(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function matchesExtensionTitle(actualTitle: string, expectedTitle: string): boolean {
    const normalizedActualTitle = normalizeExtensionTitle(actualTitle);
    const normalizedExpectedTitle = normalizeExtensionTitle(expectedTitle);
    return normalizedActualTitle === normalizedExpectedTitle;
}

async function findVisibleMatchingExtensionItem(section: ExtensionsViewSection, searchTerms: string[]): Promise<ExtensionsViewItem | undefined> {
    const visibleItems = await section.getVisibleItems();
    for (const visibleItem of visibleItems) {
        const title = await visibleItem.getTitle();
        if (searchTerms.some(candidate => matchesExtensionTitle(title, candidate))) {
            return visibleItem;
        }
    }
    return undefined;
}

async function getExtensionsSection(content: any, title: string): Promise<ExtensionsViewSection | undefined> {
    return await content.getSection(title, ExtensionsViewSection).catch(() => undefined);
}

async function findMatchingExtensionItemInSections(sections: ExtensionsViewSection[], searchTerms: string[]): Promise<ExtensionsViewItem | undefined> {
    for (const section of sections) {
        const item = await findVisibleMatchingExtensionItem(section, searchTerms);
        if (item) {
            return item;
        }
    }
    return undefined;
}

async function findMatchingExtensionItemBySearch(section: ExtensionsViewSection | undefined, prefix: '@installed' | '@enabled', searchTerms: string[]): Promise<ExtensionsViewItem | undefined> {
    if (!section) {
        return undefined;
    }

    for (const searchTerm of searchTerms) {
        const item = await section.findItem(`${prefix} ${searchTerm}`);
        if (item) {
            return item;
        }
    }

    return undefined;
}

function getPreferredExtensionSearchTerms(name: string | string[]): string[] {
    if (!Array.isArray(name)) {
        return [name];
    }
    const preferredSearchTerm = name.at(-1);
    return preferredSearchTerm ? [preferredSearchTerm] : [];
}

function isExpectedUiAbsenceError(err: unknown): boolean {
    return err instanceof error.TimeoutError || err instanceof error.NoSuchElementError;
}

function isExpectedUiInteractionError(err: unknown): boolean {
    return isExpectedUiAbsenceError(err) || err instanceof error.ElementClickInterceptedError;
}

async function getModalDialog(driver: WebDriver): Promise<ModalDialog | undefined> {
    const dialogs = await driver.findElements(By.className('monaco-dialog-box'));
    return dialogs.length > 0 ? new ModalDialog() : undefined;
}

export async function dismissModalDialogIfPresent(driver: WebDriver): Promise<void> {
    const dialog = await getModalDialog(driver);
    if (!dialog) {
        return;
    }

    let closeAttempted = false;
    try {
        await dialog.close();
        closeAttempted = true;
    } catch (err) {
        if (!isExpectedUiInteractionError(err) && !(err instanceof error.StaleElementReferenceError)) {
            throw err;
        }
    }

    if (!closeAttempted) {
        const dismissButtonTitles = new Set(['Cancel', 'No', 'Not Now', 'Later', 'Dismiss', 'Close']);
        const buttons = await dialog.getButtons().catch(() => []);
        for (const button of buttons) {
            const label = await button.getText().catch(() => '');
            if (dismissButtonTitles.has(label)) {
                await button.click();
                closeAttempted = true;
                break;
            }
        }
    }

    if (!closeAttempted) {
        throw new Error('Unexpected modal dialog without a close or dismiss action');
    }

    await driver.wait(async () => {
        return (await driver.findElements(By.className('monaco-dialog-box'))).length === 0;
    }, 10000, 'Modal dialog did not close');
}

export async function closeExtensionsViewAndEditors(driver: WebDriver): Promise<void> {
    await dismissModalDialogIfPresent(driver);

    const extensionsView = await new ActivityBar().getViewControl('Extensions').catch(() => undefined);
    if (extensionsView) {
        await extensionsView.closeView().catch(err => {
            if (!isExpectedUiInteractionError(err) && !(err instanceof error.StaleElementReferenceError)) {
                throw err;
            }
        });
    }

    await dismissModalDialogIfPresent(driver);

    try {
        await new EditorView().closeAllEditors();
    } catch (err) {
        if (err instanceof error.ElementClickInterceptedError) {
            await dismissModalDialogIfPresent(driver);
            await new EditorView().closeAllEditors();
            return;
        }
        if (isExpectedUiAbsenceError(err)) {
            return;
        }
        throw err;
    }
}

function getExtensionsFolder(): string {
    const extensionsFolder = process.env.EXTENSIONS_FOLDER;
    if (extensionsFolder === undefined) {
        throw new Error('EXTENSIONS_FOLDER environment variable is not set');
    }
    return extensionsFolder;
}

export function isExtensionInstalled(extensionId: string): boolean {
    return fs.readdirSync(getExtensionsFolder()).some(entry => entry === extensionId || entry.startsWith(`${extensionId}-`));
}

export function getInstalledExtensionPath(extensionId: string): string {
    const installedExtension = fs.readdirSync(getExtensionsFolder()).find(entry => entry === extensionId || entry.startsWith(`${extensionId}-`));
    if (installedExtension === undefined) {
        throw new Error(`Extension '${extensionId}' is not installed`);
    }
    return path.join(getExtensionsFolder(), installedExtension);
}

export function getInstalledExtensionMetadata(extensionId: string): { [key: string]: any } {
    return JSON.parse(fs.readFileSync(path.join(getInstalledExtensionPath(extensionId), 'package.json'), {
        encoding: 'utf-8'
    }));
}

export function getExtensionPackMetadata(): { [key: string]: any } {
    return JSON.parse(fs.readFileSync('package.json', {
        encoding: 'utf-8'
    }));
}

/**
 * Open the extension page.
 * 
 * @param name Display name of the extension.
 * @param timeout Timeout in ms.
 * @returns Marketplace and ExtensionViewItem object tied with the extension.
 */
export async function openExtensionPage(driver: WebDriver, name: string | string[], timeout: number): Promise<ExtensionsViewItem> {
    const searchTerms = Array.isArray(name) ? name : [name];
    const preferredSearchTerms = getPreferredExtensionSearchTerms(name);
    let item: ExtensionsViewItem | undefined;
    await driver.wait(async () => {
        try {
            await dismissModalDialogIfPresent(driver);
            const extensionsView = await (await new ActivityBar().getViewControl('Extensions'))?.openView();
            const content = extensionsView?.getContent();
            if (!content) {
                return false;
            }

            const installedSection = await getExtensionsSection(content, 'Installed');
            const enabledSection = await getExtensionsSection(content, 'Enabled');
            const sections = [installedSection, enabledSection].filter((section): section is ExtensionsViewSection => section !== undefined);
            item = await findMatchingExtensionItemInSections(sections, searchTerms);
            if (!item) {
                item = await findMatchingExtensionItemBySearch(installedSection, '@installed', preferredSearchTerms);
            }
            if (!item && !installedSection) {
                item = await findMatchingExtensionItemBySearch(enabledSection, '@enabled', preferredSearchTerms);
            }

            return item !== undefined;
        } catch (e) {
            if (e instanceof error.StaleElementReferenceError) {
                return {
                    delay: 1000,
                    value: undefined
                };
            }
            return false;
        }
    }, timeout, `Extension '${searchTerms[0]}' was not rendered`);
    return item!;
}

export async function waitUntilExtensionsViewIsReady(driver: WebDriver, timeout = 60000, interval = 1000): Promise<void> {
    await VSBrowser.instance.waitForWorkbench(Math.min(timeout, 30000));

    let stableChecks = 0;
    await driver.wait(async () => {
        try {
            const extensionsView = await (await new ActivityBar().getViewControl('Extensions'))?.openView();
            const content = extensionsView?.getContent();
            if (!content) {
                stableChecks = 0;
                return false;
            }

            const installedSection = await content.getSection('Installed', ExtensionsViewSection).catch(() => undefined);
            const enabledSection = await content.getSection('Enabled', ExtensionsViewSection).catch(() => undefined);
            const hasRelevantSection = installedSection !== undefined || enabledSection !== undefined;
            const hasViewProgress = await content.hasProgress().catch(() => false);
            const isStable = hasRelevantSection && !hasViewProgress;
            stableChecks = isStable ? stableChecks + 1 : 0;
            return stableChecks >= 3;
        } catch (e) {
            if (e instanceof error.StaleElementReferenceError) {
                stableChecks = 0;
                return {
                    delay: interval,
                    value: undefined
                };
            }
            stableChecks = 0;
            return false;
        }
    }, timeout, 'Extensions view did not finish loading', interval);
}

/**
 * Remove content from folder.
 * 
 * @param folder Path to folder.
 */
export async function deleteFolderContents(folder: string): Promise<void> {
    try {
        await fs.emptyDir(folder);
    } catch (err) {
        throw new Error('Error while deleting folder content: ' + err);
    }
}

/**
 * Executes a command in the command prompt of the workbench.
 * 
 * @param command The command to execute.
 * @returns A Promise that resolves when the command is executed.
 * @throws An error if the command is not found in the command palette.
 */
export async function executeCommand(command: string): Promise<void> {
    const workbench = new Workbench();
    await workbench.openCommandPrompt();
    const input = await InputBox.create();
    await input.setText(`>${command}`);
    const quickpicks = await input.getQuickPicks();
    for (const quickpick of quickpicks) {
        if (await quickpick.getLabel() === `${command}`) {
            await quickpick.select();
            return;
        }
    }
    throw new Error(`Command '${command}' not found in the command palette`);
}

/**
 * Wait until editor is opened.
 * 
 * @param driver WebDriver.
 * @param title Title of editor - filename.
 * @param timeout Timeout for dynamic wait.
 */
export async function waitUntilEditorIsOpened(driver: WebDriver, title: string, timeout = 10000): Promise<void> {
	await driver.wait(async function () {
		return (await new EditorView().getOpenEditorTitles()).find(t => t === title || t.includes(title));
	}, timeout);
}

/** Opens file in editor.
 * 
 * @param driver WebDriver.
 * @param folder Folder with file.
 * @param file Filename.
 * @returns Instance of Text Editor.
 */
export async function openFileInEditor(driver: WebDriver, folder: string, file: string): Promise<TextEditor | null> {
	await VSBrowser.instance.openResources(path.join(folder, file));
	await waitUntilEditorIsOpened(driver, file);
	return (await activateEditor(driver, file));
}


/**
* Switch to an editor tab with the given title.
* 
* @param title Title of editor to activate.
*/
export async function activateEditor(driver: WebDriver, title: string): Promise<TextEditor> {
    // workaround for https://issues.redhat.com/browse/FUSETOOLS2-2099
    let editor: TextEditor | null = null;
    await driver.wait(async function () {
        try {
            editor = await new EditorView().openEditor(title) as TextEditor;
            return true;
        } catch (err) {
            await driver.actions().click().perform();
            return false;
        }
    }, 10000, undefined, 500);
    throw new Error(`Couldn't activate editor with titlte '${title}'`);
}

/**
 * Checks if the terminal view has the specified texts in the given textArray.
 * 
 * @param driver The WebDriver instance to use.
 * @param textArray An array of strings representing the texts to search for in the terminal view.
 * @param interval (Optional) The interval in milliseconds to wait between checks. Default is 2000ms.
 * @param timeout (Optional) The timeout in milliseconds. Default is 60000ms.
 * @returns A Promise that resolves to a boolean indicating whether the terminal view has the texts or not.
 */
export async function waitUntilTerminalHasText(driver: WebDriver, textArray: string[], interval = 2000, timeout = 60000): Promise<void> {
    if(VSBrowser.instance.version > '1.86.2' && textArray.includes(DEBUGGER_ATTACHED_MESSAGE)) {
        // for newer VS Code versions, the Debug Bar has default floating position in collision with command palette
        // which leads to problems when trying to click on quick picks
        // solution is to move a Debug Bar a bit
        await moveDebugBar();
    }
    await driver.sleep(interval);
    await driver.wait(async function () {
        try {
            const terminal = await new BottomBarPanel().openTerminalView();
            const terminalText = await terminal.getText();
            for await (const text of textArray) {
                if (!(terminalText.includes(text))) {
                    return false;
                }
            }
            return true;
        } catch (err) {
            return false;
        }
    }, timeout, undefined, interval);
}

/**
 * Move Debug bar to avoid collision with opened command palette.
 * 
 * @param time delay to wait till debug bar is displayed.
 */
export async function moveDebugBar(time: number = 60_000): Promise<void> {
    const debugBar = await DebugToolbar.create(time);
    const dragArea = await debugBar.findElement(By.className('drag-area'));
    await dragArea.getDriver().actions().dragAndDrop(dragArea, { x: 150, y: 0}).perform();
}

/**
 * Click on 'Disconnect' button in debug bar
 * 
 * @param driver The WebDriver instance to use.
 */
export async function disconnectDebugger(driver: WebDriver, interval = 500): Promise<void> {
    let debugBar: DebugToolbar;
    try {
        debugBar = await DebugToolbar.create(2000);
    } catch (err) {
        if (isExpectedUiAbsenceError(err)) {
            return;
        }
        throw err;
    }
    await driver.wait(async function () {
        try {
            await debugBar.disconnect();
            await driver.wait(until.elementIsNotVisible(debugBar), 10000);
            return true;
        } catch (err) {
            // Extra click to avoid the error: "Element is not clickable at point (x, y)"
            // Workaround for the issue: https://issues.redhat.com/browse/FUSETOOLS2-2100 
            await driver.actions().click().perform();
            return false;
        }
    }, 10000, undefined, interval);
}

/**
 * Click on button to kill running process in Terminal View.
 */
export async function killTerminal(): Promise<void> {
    try {
        await (await new BottomBarPanel().openTerminalView()).killTerminal();
    } catch (err) {
        if (isExpectedUiAbsenceError(err)) {
            return;
        }
        throw err;
    }
}

/**
 * Adds a new key-value pair to a raw JSON string.
 * 
 * @param jsonStr The raw JSON string that will be modified.
 * @param key The new key to be added to the JSON object.
 * @param values An array of strings representing the values to be assigned to the new key.
 * @returns Updated JSON string with the new key-value pair added or Error.
 */
export function addNewItemToRawJson(jsonStr: string, key: string, values: string[]): string {
    try {
        // Parse the JSON string into an object
        let config = JSON.parse(jsonStr);

        // Add the new key-value pair
        config[key] = values;

        // Convert the object back to a JSON string
        const updatedJsonStr = JSON.stringify(config, null, 4); // Adds indentation

        return updatedJsonStr;
    } catch (error) {
        console.error("Error parsing or updating JSON:", error);
        return jsonStr; // Return the original JSON in case of error
    }
}

/**
 * Clear content in active terminal.
 */
export async function clearTerminal(): Promise<void> {
    await new BottomBarPanel().openTerminalView()
    await new Workbench().executeCommand('terminal: clear');
}

export function normalizeDisplayedExtensionTitle(title: string): string {
    return normalizeExtensionTitle(title);
}
