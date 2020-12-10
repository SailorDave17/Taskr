import {
    allUsers
} from "./sampleAllUserJson.js"

const displayAllUsersView = function (users) {
    const allUsersMainElement = document.createElement("main");
    allUsersMainElement.classList.add("all-users-main");
    const userTiles = document.createElement("section");
    userTiles.classList.add("user-tiles");
    users.forEach(user => {
    const singleUserTile = document.createElement("div");
    singleUserTile.classList.add("single-user-tile");
    singleUserTile.setAttribute("id" , user.userColor);
    singleUserTile.addEventListener("click", ()=>{
        clearChildren(allUsersMainElement);
        fetch("http://localhost:8080/api/user/" + user.id)
    .then(response => response.json())
    .then(json => console.log(json))
    .then(user => displaySingleUserView(user))
    .then(singleUserElement => mainElement.appendChild(singleUserElement))
    .catch(error => console.log(error));
    })
    const singleUserName = document.createElement("h1");
    singleUserName.classList.add("single-user-name");
    singleUserName.innerText = user.name;
    const singleUserIcon = document.createElement("img");
    singleUserIcon.classList.add("user-icon");
    singleUserIcon.setAttribute("src" , user.userIcon);
    const tasksAssigned = document.createElement("p");
    tasksAssigned.classList.add("tasks-assigned");
    tasksAssigned.innerText = "Number of Tasks: " + user.numberTasksAssigned;
    const progressBarElement = document.createElement("progress");
    progressBarElement.classList.add("progress-bar");
    const userPercentTaskDone = user.numberTasksCompleted*100/user.numberTasksAssigned;
    progressBarElement.setAttribute("value", userPercentTaskDone);
    progressBarElement.setAttribute("max", "100");
    allUsersMainElement.appendChild(userTiles);
    userTiles.appendChild(singleUserTile);
    singleUserTile.appendChild(singleUserName);
    singleUserTile.appendChild(singleUserIcon);
    singleUserTile.appendChild(tasksAssigned);
    singleUserTile.appendChild(progressBarElement);

        



    });

    // const pieChartElement = document.createElement("div")
    // pieChartElement.classList.add("piechart")

    return allUsersMainElement;

    return {
        allUsersMainElement
    }

}
const clearChildren = function (element) {
    while (element.firstChild) {
        element.removeChild(element.lastChild);
    }
}


export {
    displayAllUsersView
}