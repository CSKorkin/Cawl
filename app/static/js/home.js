function updateGradient() {
  const h = window.innerHeight;
  const stop1 = Math.round(h * 0.6);
  const stop2 = h;
  document.documentElement.style.setProperty('--grad-stop1', stop1 + 'px');
  document.documentElement.style.setProperty('--grad-stop2', stop2 + 'px');
}

window.addEventListener('resize', updateGradient);
document.addEventListener('DOMContentLoaded', updateGradient);
