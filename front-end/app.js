import {
    displayHeader
} from "./js/header.js"

import {
    displaySingleUserView
} from "./js/singleuserview.js"

import {
    createFooter
} from "./js/footer.js"

import {
    displayAllUsersView
} from "./js/allusersview.js"

const container = document.querySelector('.container');

container.prepend(displayHeader());

//This is the path to the all user view.
const allUsersMainElement = document.createElement("main");
allUsersMainElement.classList.add("all-users-main");
container.appendChild(allUsersMainElement);



fetch("http://localhost:8080/api/users")
    .then(response => response.json())
    // .then(json => console.log(json))
    .then(users => displayAllUsersView(users))
    .then(allUsersView => allUsersMainElement.appendChild(allUsersView))
    .catch(error => console.log(error));



container.appendChild(createFooter());

export { allUsersMainElement }