export function byId(id) { return document.getElementById(id); }

export function setText(id, txt) { byId(id).textContent = txt; }
export function setHidden(id, hidden) { byId(id).classList.toggle("hidden", hidden); }
export function setDisabled(id, dis) { byId(id).disabled = !!dis; }

export function fileRow({ file, onSelectToggle, selectedDirector, selectedLocal }) {
  const row = document.createElement("div");
  let cls = "file-row";
  if (selectedDirector) cls += " selected-director";
  else if (selectedLocal) cls += " selected-local";
  row.className = cls;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;

  const badge = document.createElement("span");
  badge.className = "badge " + (file.ready ? "ready" : "fetching");
  badge.textContent = file.ready ? "ready" : "fetching";

  row.appendChild(name);
  row.appendChild(badge);
  row.onclick = () => onSelectToggle && onSelectToggle(file.fileId);
  return row;
}

export function plusRow({ onAdd }) {
  const row = document.createElement("div");
  row.className = "file-row";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = "+ Add file";
  row.appendChild(name);
  row.onclick = () => onAdd && onAdd();
  return row;
}
