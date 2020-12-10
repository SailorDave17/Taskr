import {
    allUsers
} from "./sampleAllUserJson.js"

// import {
//     clearChildren
// } from "./singleuserview.js"

const displayAllUsersView = function(users) {
    const allUsersMainElement = document.createElement("main");
    allUsersMainElement.classList.add("all-users-main");
    const userTiles = document.createElement("section");
    userTiles.classList.add("user-tiles");
    // userTiles.innerText = "Electric Boogaloo 2: Rendering the View";
    // clearChildren(userTiles);
    users.forEach(user => {
    const singleUserTile = document.createElement("div");
    singleUserTile.classList.add("single-user-tile");
    singleUserTile.setAttribute("id" , user.userColor);
    singleUserTile.innerText = "Electric Boogaloo";
    const singleUserName = document.createElement("h1");
    singleUserName.classList.add("single-user-name");
    singleUserName.innerText = user.name;
    const singleUserIcon = document.createElement("img");
    singleUserIcon.classList.add("user-icon");
    const userIcon = "/front-end/images/mom.png";
    if(user.userIcon === "sis.ico") {
        userIcon = "front-end/images/sis.png";
    }
    if(user.userIcon === "dad.ico") {
        userIcon = "front-end\images\Dad.png";
    }
    singleUserIcon.setAttribute("src" , userIcon);
    // const tasksAssigned = document.createElement("p");
    // tasksAssigned.classList.add("tasks-assigned");
    // tasksAssigned.innerText = "number of tasks";
    // const progressBarElement = document.createElement("progress");
    // progressBarElement.classList.add("progress-bar");
    // const numberOfTaskDone = 2;
    // const userPercentTaskDone = numberOfTaskDone/tasksAssigned;
    // progressBarElement.setAttribute("value", userPercentTaskDone);
    // progressBarElement.setAttribute("max", "100");
    allUsersMainElement.appendChild(userTiles);
    userTiles.appendChild(singleUserTile);
    singleUserTile.appendChild(singleUserName);
    singleUserTile.appendChild(singleUserIcon);

        
    }); 

    // const pieChartElement = document.createElement("div")
    // pieChartElement.classList.add("piechart")

    return allUsersMainElement;

}


export{
    displayAllUsersView
}