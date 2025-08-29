
export function byId(id) { return document.getElementById(id); }

export function setText(id, txt) { byId(id).textContent = txt; }
export function setHidden(id, hidden) { byId(id).classList.toggle("hidden", hidden); }
export function setDisabled(id, dis) { byId(id).disabled = !!dis; }

export function fileRow({ file, onSelectToggle }) {
  const row = document.createElement("div");
  row.className = "file-row";
  const name = document.createElement("span");
  name.textContent = `${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
  const badge = document.createElement("span");
  badge.className = "badge " + (file.ready ? "ready" : "fetching");
  badge.textContent = file.ready ? "ready" : "fetching";
  const btn = document.createElement("button");
  btn.textContent = "Select";
  btn.onclick = () => onSelectToggle(file.fileId);
  row.appendChild(name);
  row.appendChild(badge);
  row.appendChild(btn);
  return row;
}
