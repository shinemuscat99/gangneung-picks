/*
 * 화면 움직임 전용 파일 (motion.js)
 *   - 카드에 커서를 올리면 빛이 따라오는 스포트라이트
 *   - 결과 화면을 스크롤하면 카드가 부드럽게 나타나는 리빌
 * 선택 흐름과 데이터에는 관여하지 않아요. 이 파일이 없어도 페이지는 그대로 동작합니다.
 */
(function () {
  // 스포트라이트: 커서 위치를 카드의 CSS 변수(--mx, --my)로 넘김
  const SPOT = ".option, .place-card, .step-tip, .other-areas summary";

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || !(e.target instanceof Element)) return;
    const card = e.target.closest(SPOT);
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - box.left}px`);
    card.style.setProperty("--my", `${e.clientY - box.top}px`);
  });

  // 리빌: '움직임 줄이기'를 켠 기기에서는 처음부터 다 보이게 둠
  const result = document.getElementById("screen-result");
  if (!result || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const REVEAL = ".place-card, .other-areas, .suggestions, .result-actions";

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.05 });

  function watch() {
    result.querySelectorAll(REVEAL).forEach((el) => {
      if (el.classList.contains("reveal")) return;
      el.classList.add("reveal");
      observer.observe(el);
    });
  }

  // 결과 카드는 app.js가 그때그때 새로 만들기 때문에 변화를 지켜봄
  new MutationObserver(watch).observe(result, { childList: true, subtree: true });
  watch();
})();
