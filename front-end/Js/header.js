const createHeader = function () {
    const header = document.createElement("header");
    header.classList.add("title")
    header.innerText = "Taskr Single User View";
    const mainDropDownMenu = document.createElement("div");
    mainDropDownMenu.classList.add("dropdown");
    const mainDropDownMenuButton = document.createElement("button");
    mainDropDownMenuButton.classList.add("dropbtn");
    const mainDropDownMenuImage = document.createElement("img");
    mainDropDownMenuImage.classList.add("hamburger");
    mainDropDownMenuImage.setAttribute("src", "/front-end/images/menu.png");
    mainDropDownMenuImage.setAttribute("width", "100px");
    const mainDropDownMenuContent = document.createElement("div");
    mainDropDownMenuContent.classList.add("dropdown-content");
    const mainDropDownMenuFirstItem = document.createElement("a");
    mainDropDownMenuFirstItem.classList.add("menu-item");
    mainDropDownMenuFirstItem.setAttribute("href", "/front-end/household-taskview.html");
    mainDropDownMenuFirstItem.innerText = "All Tasks";
    header.prepend (mainDropDownMenu);
    mainDropDownMenu.appendChild(mainDropDownMenuButton);
    mainDropDownMenu.appendChild(mainDropDownMenuImage);
    mainDropDownMenu.appendChild(mainDropDownMenuContent);
    mainDropDownMenu.appendChild(mainDropDownMenuFirstItem);



    // const displaySingleUserView = document.querySelector(".display-single-user-view");
    // displaySingleUserView.addEventListener('click', () => displaySingleUserView(user));

    //     fetch("http://localhost:8080/api/user/1")
    //         .then(response => response.json())
    //         .then(user => displaySingleUserView(user))
    //         .catch(error => console.log(error));
    //     ); singleuserview(user));

    // backToAllCampuses.addEventListener('click', () => {
    //     clearChildren(mainContent);
    //     fetch("http://localhost:8080/api/campuses")
    //         .then(response => response.json())
    //         .then(campuses => displayHomeView(campuses))
    //         .then(campusesElement => mainContent.appendChild(campusesElement))
    //         .catch(error => console.log(error));
    // });


    // const displayAllUserView = document.querySelector(".display-all-users-view");
    // displayAllUserView.addEventListener('click', () => allusersview(user));


    // const displayAllTasksView = document.querySelector(".display-all-tasks-view");
    // displayAllTasksView.addEventListener('click', () => alltasksview(task));


    // const displayCustomizeTasksView = document.querySelector(".display-customize-tasks-view");
    // displayCustomizeTasksView.addEventListener('click', () => customizetasksview(task));


    // const displayCustomizeUsersView = document.querySelector(".display-customize-users-view");
    // displayCustomizeUsersView.addEventListener('click', () => customizeusersview(user));

    return header;

}



export {
    createHeader
}

