// Carousel state
let currentSlide = 0;
const totalSlides = 6;

// Touch swipe state
let touchStartX = 0;
let touchEndX = 0;

// DOM elements
let slides;
let dots;
let prevButton;
let nextButton;
let carousel;

/**
 * Initialize the carousel when DOM is ready
 */
function init() {
  // Get DOM elements
  slides = document.querySelectorAll('.slide');
  dots = document.querySelectorAll('.dot');
  prevButton = document.getElementById('prevButton');
  nextButton = document.getElementById('nextButton');
  carousel = document.getElementById('carousel');

  // Set up event listeners for navigation buttons
  prevButton.addEventListener('click', prevSlide);
  nextButton.addEventListener('click', nextSlide);

  // Set up event listeners for dots
  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => goToSlide(index));
  });

  // Set up touch swipe support
  carousel.addEventListener('touchstart', handleTouchStart, { passive: true });
  carousel.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Initialize UI
  updateUI();
}

/**
 * Update the UI to reflect the current slide
 */
function updateUI() {
  // Update slides visibility with transition
  slides.forEach((slide, index) => {
    if (index === currentSlide) {
      slide.classList.add('active');
      slide.classList.remove('entering', 'leaving');
    } else {
      slide.classList.remove('active');
    }
  });

  // Update dots
  dots.forEach((dot, index) => {
    if (index === currentSlide) {
      dot.classList.add('bg-orange-500', 'scale-110');
      dot.classList.remove('bg-gray-300', 'hover:bg-gray-400');
    } else {
      dot.classList.remove('bg-orange-500', 'scale-110');
      dot.classList.add('bg-gray-300', 'hover:bg-gray-400');
    }
  });

  // Update navigation buttons visibility
  if (currentSlide > 0) {
    prevButton.style.display = 'flex';
  } else {
    prevButton.style.display = 'none';
  }

  if (currentSlide < totalSlides - 1) {
    nextButton.style.display = 'flex';
  } else {
    nextButton.style.display = 'none';
  }
}

/**
 * Go to the next slide
 */
function nextSlide() {
  if (currentSlide < totalSlides - 1) {
    // Add transition classes
    slides[currentSlide].classList.add('leaving');
    currentSlide++;
    slides[currentSlide].classList.add('entering');

    // Small delay to trigger transition
    setTimeout(() => {
      updateUI();
    }, 10);
  }
}

/**
 * Go to the previous slide
 */
function prevSlide() {
  if (currentSlide > 0) {
    // Add transition classes
    slides[currentSlide].classList.add('leaving');
    currentSlide--;
    slides[currentSlide].classList.add('entering');

    // Small delay to trigger transition
    setTimeout(() => {
      updateUI();
    }, 10);
  }
}

/**
 * Go to a specific slide
 * @param {number} index - The index of the slide to navigate to
 */
function goToSlide(index) {
  if (index >= 0 && index < totalSlides && index !== currentSlide) {
    slides[currentSlide].classList.add('leaving');
    currentSlide = index;
    slides[currentSlide].classList.add('entering');

    setTimeout(() => {
      updateUI();
    }, 10);
  }
}

/**
 * Handle touch start event
 * @param {TouchEvent} e - The touch event
 */
function handleTouchStart(e) {
  // Use clientX for better cross-browser compatibility
  touchStartX = e.changedTouches[0].clientX;
}

/**
 * Handle touch end event
 * @param {TouchEvent} e - The touch event
 */
function handleTouchEnd(e) {
  // Use clientX for better cross-browser compatibility
  touchEndX = e.changedTouches[0].clientX;
  handleSwipe();
}

/**
 * Detect swipe direction and navigate accordingly
 */
function handleSwipe() {
  const swipeThreshold = 50;
  const diff = touchStartX - touchEndX;

  // Debug logging (can be removed in production)
  if (Math.abs(diff) > 10) {
    console.log('Swipe detected:', {
      start: touchStartX,
      end: touchEndX,
      diff: diff,
      threshold: swipeThreshold,
    });
  }

  if (diff > swipeThreshold) {
    // Swiped left, go to next slide
    console.log('→ Next slide');
    nextSlide();
  } else if (diff < -swipeThreshold) {
    // Swiped right, go to previous slide
    console.log('← Previous slide');
    prevSlide();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
