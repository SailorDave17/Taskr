import {
    displayHeader
} from "./js/header.js"

import {
    displaySingleUserView
} from "./js/singleuserview.js"

import {
    createFooter
} from "./js/footer.js"

const container = document.querySelector('.container');

container.prepend(displayHeader());
const mainElement = document.createElement("main");
mainElement.classList.add("main-content");
container.appendChild(mainElement);
// const userNamePageElement = document.createElement("h1");
// userNamePageElement.classList.add("username");
// container.appendChild(userNamePageElement);


fetch("http://localhost:8080/api/user/3")
    .then(response => response.json())
    //.then(json => console.log(json))
    .then(user => displaySingleUserView(user))
    .then(singleUserElement => mainElement.appendChild(singleUserElement))
    .catch(error => console.log(error));

container.appendChild(createFooter())
