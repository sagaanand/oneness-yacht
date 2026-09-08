/*Mobile Validation*/
$("[mobile-10]").on('blur', function (e) {
    e.preventDefault();
    const elem = $(this);
    elem.closest(".inputDiv").find(".messageBox").text("");
    const value = $(this).val();
    if (value !== "") {
        if (!value.match('[1-9]{1}[0-9]{9}')) {
            elem.closest(".inputGroupDiv").find(".messageBox").text("Please enter 10 digit mobile number");
            elem.val('');
            elem.focus();
            return false;
        }
    }
   });

/*Email Validation*/
$("input[type='email']").on('blur', function (e) {
    e.preventDefault();
    const elem = $(this);
    elem.closest(".inputGroupDiv").find(".messageBox").text("");
    const reg = /^([A-Za-z0-9_\-\.])+\@([A-Za-z0-9_\-\.])+\.([A-Za-z]{2,4})$/;
    const value = elem.val();
    if (value !== "") {
        if (reg.test(value) === false) {
            elem.closest(".inputGroupDiv").find(".messageBox").text("Invalid Email Address");
            elem.val('');
            elem.focus();
            return false;
        }
    }
   });

/*Input Validation*/
$("select[value]").each(function(){
    const value = $(this).attr('value');
    if(value !== ""){
        $(this).val(value);
    }
    });


/*Loading Button*/
function showButtonLoading(element) {
 element.find('span').append('<i class="loader"></i>');
 element.prop('disabled', true);
}

function hideButtonLoading(element) {
 element.find("i").remove();
 element.prop('disabled', false);
}

function showFormMessage(element, message, mode) {
 element.text(message);
 element.attr('mode', mode);
 element.show('fast');
}

/*MessageBox Alert Function*/
function resetMessageBoxes() {
 const messageBox = $('.messageBox');
 messageBox.attr('mode', '');
 messageBox.text('');
}

function formMessageError(element, message) {
 showFormMessage(element, message, 'error');
}

function formMessageSuccess(element, message) {
 showFormMessage(element, message, 'success');
}

function formMessageWarning(element, message) {
 showFormMessage(element, message, 'warning');
}

function formMessageInfo(element, message) {
 showFormMessage(element, message, 'Info');
}


function formatData(data, type) {
 try {
     if (type === 'int') {
         return parseInt(data);
     } else if (type === 'bool') {
         return JSON.parse(data);
     } else if (type === 'float') {
         return parseFloat(data);
     } else {
         return data;
     }
 } catch (err) {
    console.log(err.message);
     return null;
 }

}
function validate(formSelect, requiredAttr, messageElem) {
 formSelect = formSelect || ""
 requiredAttr = requiredAttr || "[required]"
 messageElem = messageElem || ".messageBox"
 $(messageElem).html('');
 let bool = true;
 $(formSelect).find(requiredAttr).each(function () {
     const elem = $(this);
     if (elem.val() === '') {
         const field = elem.attr("id");
         const txt = "Please enter " + field;
         elem.closest(".inputGroupDiv").find(messageElem).text(txt);
         elem.focus();
         bool = false;
         return false;
     }
 });
 return bool;
}
function getFormData(selector, fieldNameSelector = "id") {
 let formData = {};
 resetMessageBoxes();
 $(selector).each(function () {
     const elem = $(this);
     const dataType = elem.attr("data-type");
     if (elem.attr("type") === 'checkbox' || elem.attr("type") === 'radio') {
         if (!$(elem).is(":checked")) {
             return;
         }
     }
     let data = formatData(elem.val(),dataType);

     const field = elem.attr(fieldNameSelector);
     console.log(field,data);
     if (hasAttr(elem, 'required') && (data === '' || data == null)) {
         const messageBox = elem.closest('.inputDiv').find('.messageBox');
         formMessageError(messageBox, "please enter value");
         $('html, body').animate({
             scrollTop: elem.offset().top
         }, 1000);
         throw new Error("required data missing - " + field + " - " + data);

     }
     if (hasAttr(elem, 'array')) {
         const arrVal = $(this).attr('array');

         if (dataType === 'array') {
             if (typeof formData[arrVal] === 'undefined') {
                 formData[arrVal] = {};
             }
             if (typeof formData[arrVal][field] === 'undefined') {
                 formData[arrVal][field] = [];
             }
             //console.log(arrVal);
             //console.log(field);
             //console.log(formData[arrVal][field]);
             formData[arrVal][field].push(data);
             //console.log(formData[arrVal][field]);
         } else {
             if (typeof formData[arrVal] === 'undefined') {
                 formData[arrVal] = {};
             }
             if (data != null) {
                 formData[arrVal][field] = data;
             }
         }
     } else {
         if (dataType === 'array') {
             if (typeof formData[field] === 'undefined') {
                 formData[field] = {};
             }
             if (data != null) {
                 formData[field].push(data);
             }
         } else {
             if (data != null) {
                 formData[field] = data;
             }
         }
     }
 });
 //console.log(formData['privilegesData']);
 //console.log(JSON.stringify(formData['privilegesData'], null, 4));
 return formData;
}
function isJSON(data){
 try{
     JSON.parse(data)
     return true;
 }catch (e) {
     return false;
 }
}
function processAjaxReturnData(responseData, func = {
 success: '',
 loginFailure: '',
 validation: '',
 userNotExists: '',
 userExists: '',
 authorization: '',
 error: ''
}) {
 try {
     if(isJSON(responseData)) {
         responseData = JSON.parse(responseData);
     }
     const response = parseInt(responseData.response);
     const ajaxReturnData = ('data' in responseData) ? responseData.data : '';
     const ajaxReturnMessage = ('message' in responseData) ? responseData.message : 'Some error occurred';
     console.log(response);
     if (response === 200) {
         if (typeof func.success == "function") {
             func.success(ajaxReturnData);
         }
     } else if (response === 417) {
         if (typeof func.validation == "function") {
             func.validation(responseData);
         } else {
             notify('error', 'Error!', "Invalid data");
         }
     } else if (response === 107) {
         if (typeof func.loginFailure == "function") {
             func.loginFailure(responseData);
         } else {
             notify('error', 'Error!', "Invalid email or password");
         }
     } else if (response === 105) {
         if (typeof func.userNotExists == "function") {
             func.userNotExists(responseData);
         } else {
             notify('error', 'Error!', "User not exists");
         }
     } else if (response === 106) {
         if (typeof func.userExists == "function") {
             func.userExists(responseData);
         } else {
             notify('error', 'Error!', "User exists");
         }
     } else if (response === 401) {
         if (typeof func.authorization == "function") {
             func.authorization(responseData);
         } else {
             notify('error', 'Error!', "You are not authorized");
         }
     } else {
         if (typeof func.error == "function") {
             func.error(responseData);
         } else {
             notify('error', 'Error!', ajaxReturnMessage);
         }
     }
 } catch (err) {
     console.log(err);
 }
}

function hasAttr(elem, attribute) {
 const attr = $(elem).attr(attribute);
 return typeof attr !== 'undefined' && attr !== false;
}


/*Passowrd Show/Hide*/
function passwordTextShow(passwordElementSelector, showButtonSelector, hideButtonSelector, toggleClassName) {
 const password = $(passwordElementSelector);
 if (password.attr("type") === "password") {
     password.attr("type", "text");
 } else {
     password.attr("type", "password");
 }
 $(showButtonSelector).toggleClass(toggleClassName);
 $(hideButtonSelector).toggleClass(toggleClassName);
}
