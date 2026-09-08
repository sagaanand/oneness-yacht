/* ==========================================================================
   ONENESS LUXURY YACHTS — CLIENT SCRIPT
   Superyacht UI/UX Interactions: Sticky Header, Fleet Filtering, Lightbox,
   Mobile Drawer, and Secure DOM-Safe Booking Inquiries
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Transparent to Translucent Header on Scroll
  const header = document.getElementById('siteHeader');
  if (header) {
    const handleScroll = () => {
      if (window.scrollY > 40) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check
  }

  // 2. Mobile Drawer Navigation
  const mobileBtn = document.getElementById('mobileMenuBtn');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');

  function openDrawer() {
    mobileDrawer?.classList.add('open');
    drawerOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    mobileDrawer?.classList.remove('open');
    drawerOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  }

  mobileBtn?.addEventListener('click', openDrawer);
  drawerCloseBtn?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);

  // Close drawer when pressing Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeLightbox();
    }
  });

  // 3. Fleet Filtering (Catalogue Page)
  const filterPills = document.querySelectorAll('.fleet-filter-pill');
  const yachtCards = document.querySelectorAll('.yacht-card');

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      const filter = pill.getAttribute('data-filter');

      yachtCards.forEach(card => {
        const category = card.getAttribute('data-category') || '';
        const length = parseInt(card.getAttribute('data-length') || '0', 10);

        if (filter === 'all') {
          card.style.display = 'flex';
        } else if (filter === 'vip') {
          card.style.display = (category.toLowerCase().includes('vip') || length >= 100) ? 'flex' : 'none';
        } else if (filter === 'standard') {
          card.style.display = (length < 100) ? 'flex' : 'none';
        } else if (filter === 'mega') {
          card.style.display = (length >= 130) ? 'flex' : 'none';
        }
      });
    });
  });

  // 4. Secure, DOM-Safe Inquiry Form Submission
  const inquiryForms = document.querySelectorAll('.inquiry-form');
  inquiryForms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const alertBox = form.querySelector('.form-alert-box');
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : 'Submit';

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Transmitting Request...';
      }

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      try {
        const response = await fetch('/api/inquire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok && result.success) {
          if (alertBox) {
            alertBox.className = 'form-alert-box success';
            alertBox.style.display = 'block';
            // Safe DOM insertion to prevent XSS
            alertBox.textContent = `Thank You. Your private charter request has been received. Our concierge will contact you at ${payload.phone || 'your phone number'} shortly.`;
          }
          form.reset();

          // Offer quick WhatsApp connect
          setTimeout(() => {
            const waText = encodeURIComponent(
              `Hello Oneness Yachts, I just submitted an inquiry for ${payload.yacht || 'a private yacht charter'} on ${payload.date || 'upcoming date'} for ${payload.guests || 'guests'}. Name: ${payload.name}`
            );
            const waWindow = confirm('Would you like to instantly connect with our Dubai Concierge on WhatsApp?');
            if (waWindow) {
              window.open(`https://wa.me/971585441134?text=${waText}`, '_blank');
            }
          }, 700);
        } else {
          throw new Error(result.message || 'Error submitting request');
        }
      } catch (err) {
        if (alertBox) {
          alertBox.className = 'form-alert-box error';
          alertBox.style.display = 'block';
          alertBox.textContent = `Notice: ${err.message || 'Could not send message. Please contact us via WhatsApp.'}`;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
  });

  // 5. Global Lightbox Modal Functions
  const lightbox = document.getElementById('globalLightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxClose = document.getElementById('lightboxClose');

  window.openLightbox = function(imgSrc) {
    if (lightbox && lightboxImage) {
      lightboxImage.src = imgSrc;
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  };

  function closeLightbox() {
    if (lightbox) {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  // 6. Smooth Scroll For Internal Anchor Links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
});
