const copy = JSON.parse(document.getElementById("copy").textContent);
const nodes = [...document.querySelectorAll("[data-node]")];
for (const node of nodes) node.addEventListener("click", () => {
  const index = Number(node.dataset.node);
  for (const other of nodes) other.setAttribute("aria-pressed", String(other === node));
  document.getElementById("role").textContent = copy.steps[index];
  document.getElementById("meaning").textContent = copy.labels[index];
  document.getElementById("detail").textContent = copy.detail[index];
  document.getElementById("evidence").textContent = copy.files[index];
});
const motion = document.getElementById("motion");
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
function updateMotion() { document.body.classList.toggle("paused", paused); motion.setAttribute("aria-pressed", String(paused)); motion.textContent = paused ? copy.play : copy.pause; }
motion.addEventListener("click", () => { paused = !paused; updateMotion(); });
updateMotion();
