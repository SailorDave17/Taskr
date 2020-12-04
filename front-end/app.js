import{
    createHeader
} from "./js/header.js"

import{
    displaySingleUserView 
} from "./js/singleuserview.js"

import{
    createFooter
} from "./js/footer.js"

const container = document.querySelector ('.container');

container.prepend(createHeader());
// const userNamePageElement = document.createElement("h1");
// userNamePageElement.classList.add("username");
// container.appendChild(userNamePageElement);


fetch("http://localhost:8080/api/user/1" , {
    mode: 'no-cors'
})
.then(response => response.json())
.then(json => console.log(json))
// .then(users => displaySingleUserView(users))
.catch(error => console.log (error));

container.appendChild(createFooter())
