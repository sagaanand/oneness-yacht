addActiveClassToMenu();

function addActiveClassToMenu() {
    const url = window.location.pathname;
    const menuListItems = $(".mainMenu");
    menuListItems.removeClass('activeMenu');
    menuListItems.each(function() {
        let menuURL = $(this).find('a').attr('href');
        if (url === menuURL) {
            $(this).addClass('activeMenu');
        } else {
            if (url.startsWith(menuURL) && menuURL !== "/") {
                $(this).addClass('activeMenu');
            }
        }
    });
}
$('textarea').on('input', function () {
    const elem = $(this);
    elem.css('height', "5px");
    elem.css("height" , elem.css("scrollHeight") + "px");
   });
   
/* function for sliding cards*/
function sideScrollCards(elementWrapper, cardCalss, direction, increment, animationFunction) {
    increment = increment || 1;
    var slideIndex = elementWrapper + 'Index';
    window[slideIndex] = (typeof window[slideIndex] != 'undefined') ? window[slideIndex] : 0;
    var cardCalssList = document.getElementsByClassName(cardCalss);
    var firstCard = cardCalssList[0];
    var wrapperDiv = document.getElementById(elementWrapper);
    wrapperDiv.style.transition = 'transform 0.6s ease';
    var cardNos = cardCalssList.length;
    var cardWidth = firstCard.offsetWidth;
    var distanceToTransalte = 0;
    var wrapperWidth = wrapperDiv.offsetWidth;
    var cardStyle = firstCard.currentStyle || window.getComputedStyle(firstCard);
    var wrapperStyle = wrapperDiv.currentStyle || window.getComputedStyle(wrapperDiv);
    var cardOuterWidth = cardWidth + parseFloat(cardStyle.marginRight) + parseFloat(cardStyle.marginLeft);
    var wrapperInnerWidth = wrapperWidth - (parseFloat(wrapperStyle.paddingRight) + parseFloat(wrapperStyle.paddingLeft));
    var totalWidthOfCards = cardOuterWidth * cardNos;
    if (direction === 'prev') {
        window[slideIndex] = (window[slideIndex] > 0) ? window[slideIndex] - increment : 0;
    } else if (direction === 'next') {
        window[slideIndex] = (window[slideIndex] <= cardNos) ? window[slideIndex] + increment : 0;
    }
    console.log('fnindex : ' + window[slideIndex]);
    //window[slideIndex] = (window[slideIndex] > (cardNos - 1)) ? 0 : window[slideIndex];
    distanceToTransalte = window[slideIndex] * cardOuterWidth;
    if (distanceToTransalte > ((totalWidthOfCards - wrapperInnerWidth) + (cardOuterWidth * increment))) {
        window[slideIndex] = 0;
        distanceToTransalte = 0;
    } else if (distanceToTransalte > (totalWidthOfCards - wrapperInnerWidth)) {
        distanceToTransalte = totalWidthOfCards - wrapperInnerWidth;
        window[slideIndex] = cardNos;
    }
    distanceToTransalte = (distanceToTransalte === 0) ? 0 : '-' + distanceToTransalte;
    wrapperDiv.style.transform = 'translateX(' + distanceToTransalte + 'px)';
    if (animationFunction) {
        animationFunction();
    }
}

/*Dropdown Function*/
$(document).ready(function() {
    $(document).on('click', ".dropBox", function(e) {
        e.preventDefault();
        let dropBox = $(this);
        let dropSection = dropBox.closest('.dropSection');
        dropSection.find('.dropContent').slideUp();
        /* $(".dropBox").removeClass("activeDropBox");*/
        let dropContent = dropBox.closest(".dropList").find(".dropContent");
        dropContent.slideUp();
        if (dropBox.find(".dropAdd").is(":hidden")) {
            dropBox.find(".dropRemove").hide();
            dropBox.find(".dropAdd").show();
        } else {
            dropBox.find(".dropRemove").show();
            dropBox.find(".dropAdd").hide();
            let dropContent = dropBox.closest(".dropList").find(".dropContent");
            dropContent = dropContent.not(dropContent.find(".dropContent"));
            /* select child dropContent */
            dropContent.slideDown();
            /*let childDropContent = dropContent.find(".dropContent");
            childDropContent.slideUp(0);*/
        }
    });
});

function tabBar(parentContainer, index, event) {
    event.preventDefault();
    $(parentContainer + ' .tabMenu').removeClass("activeTabMenu");
    const elem = $(event.target);
    elem.addClass("activeTabMenu");
    let scrollValue = parseInt(index) * 100;
    if (scrollValue > 0) {
        scrollValue = '-' + scrollValue;
    }
    const tabBarWrapper = $(parentContainer + " .tabBarWrapper");
    tabBarWrapper.css("transition", 'all .5s');
    tabBarWrapper.css("left", +scrollValue + '%');
    const tabContainers = $(parentContainer + ' .tabBarSlide');
    tabContainers.css("height", '0');
    tabContainers.css("opacity", '0');
    const activeTabContainer = $(parentContainer + ' .tabBarSlide:nth-child(' + (parseInt(index) + 1) + ')');
    activeTabContainer.css("height", 'auto');
    activeTabContainer.css("opacity", '1');
}

/*onScroll Hide Function*/
function menuShowHideOnScroll() {
    var currentScrollPos = window.pageYOffset;
    if (currentScrollPos <= 200) {
        $(".scrollTop").removeClass("scrollTopIntro");
        $(".scrollBottom").removeClass("scrollBottomIntro");
    } else if (prevScrollpos >= currentScrollPos) {
        $(".scrollTop").removeClass("scrollTopIntro");
        $(".scrollBottom").removeClass("scrollBottomIntro");
    } else {
        $(".scrollTop").addClass("scrollTopIntro");
        $(".scrollBottom").addClass("scrollBottomIntro");
    }
    prevScrollpos = currentScrollPos;
}


/* function for hiding showing navbar*/
var prevScrollpos = window.pageYOffset;
$(window).on("scroll", function() {
    menuShowHideOnScroll();
    headerScrollIntro();
});


function headerScrollIntro() {
    let header = $(".headerSection");
    let currentScrollPos = window.pageYOffset;
    if (currentScrollPos <= 100) {
        header.removeClass("headerIntro");
    } else {
        header.addClass("headerIntro");
    }
    prevScrollpos = currentScrollPos;
}

$(".popupClose").click(function() {
    let section = $(this).closest("section");
    section.removeClass("popupIntro");
});



$(document).ready(function() {
    $('.menuIcon').click(function() {
        $('.navSection').toggleClass('navSectionIntro');
        $('.menuIcon').toggleClass('menuIconIntro');
        $('.subMenuContainer').removeClass('subMenuContainerIntro');
        // $(".menuCloseBg").show();
    });

    $(".mainMenu").on("click", function(e) {
        $('.subMenuContainer').removeClass('subMenuContainerIntro');
        $(this).closest('.navMenu').find('.subMenuContainer').toggleClass('subMenuContainerIntro');
    });

    $('.actionBtn').click(function () {
        $(".enquiryForm").addClass("enquiryFormIntro");
        $(".enquiryForm").removeClass("enquiryFormCloseIntro");
        $(".wallSection").css("z-index", "100");
        $("body").addClass("bodyIntro");
    });
    $('.enquiryFormClose').click(function () {
        $(".enquiryForm").addClass("enquiryFormCloseIntro");
        $(".enquiryForm").removeClass("enquiryFormIntro");
        $(".wallSection").css("z-index", "");
        $("body").removeClass("bodyIntro");
    });
    $('.propertyBookingBtn').click(function () {
        $(".propertyBookingForm").addClass("propertyBookingFormIntro");
        $("body").addClass("bodyIntro");
    });
    $('.propertyBookingForm .closeform').click(function () {
        $(".propertyBookingForm").removeClass("propertyBookingFormIntro");
        $("body").removeClass("bodyIntro");
    });
});

const phoneNumber = "971585441134"; // Common phone number

document.querySelectorAll('.whatsapp-link').forEach(link => {
  const customMessage = encodeURIComponent(link.getAttribute('data-message'));
  link.href = `https://wa.me/${phoneNumber}?text=${customMessage}`;
});



$('.mediaFile').click(function() {
    $(".mediaDiv").addClass("mediaPoupIntro");
    $("body").addClass("bodyIntro");
});
$('.mediaDiv .popupClose').click(function() {
    $(".mediaDiv").removeClass("mediaPoupIntro");
    $("#media").removeAttr("style");
    $("body").removeClass("bodyIntro");
});
$('.mediaDiv .popupClose').click(function() {
    $(".mediaDiv").removeClass("mediaPoupIntro");
    $("#media").removeAttr("style");
    $("body").removeClass("bodyIntro");
});
