// The page of the small settings window: enter or remove the API key. The key goes to the main
// process once and is never sent back; this page only learns whether one is saved.

const stateEl = document.getElementById('state') as HTMLElement;
const keyEl = document.getElementById('key') as HTMLInputElement;
const messageEl = document.getElementById('message') as HTMLElement;

async function refresh(): Promise<void> {
  const status = await window.talkthroughSettings.status();
  stateEl.textContent = !status.available
    ? 'This computer cannot encrypt a key for your account, so none can be saved.'
    : status.saved ? 'A key is saved.' : 'No key is saved.';
}

document.getElementById('save')!.addEventListener('click', async () => {
  messageEl.textContent = '';
  const result = await window.talkthroughSettings.save(keyEl.value);
  keyEl.value = ''; // the page never keeps the key
  messageEl.textContent = result.ok ? '' : result.message;
  await refresh();
});
document.getElementById('remove')!.addEventListener('click', async () => {
  messageEl.textContent = '';
  await window.talkthroughSettings.clear();
  await refresh();
});
document.getElementById('close')!.addEventListener('click', () => window.close());
void refresh();
