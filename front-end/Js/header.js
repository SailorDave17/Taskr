const createHeader = function () {
    const header = document.createElement("header");
    header.classList.add("title")
    header.innerText = "Taskr Single User View";
    const displaySingleUserView= document.querySelector(".display-single-user-view");     
    displaySingleUserView.addEventListener('click', ()=> singleuserview(user));
    

    const displayAllUserView= document.querySelector(".display-all-users-view");     
    displayAllUserView.addEventListener('click', ()=> allusersview(user));


    const displayAllTasksView= document.querySelector(".display-all-tasks-view");     
    displayAllTasksView.addEventListener('click', ()=> alltasksview(task));


    const displayCustomizeTasksView= document.querySelector(".display-customize-tasks-view");     
    displayCustomizeTasksView.addEventListener('click', ()=> customizetasksview(task));


    const displayCustomizeUsersView= document.querySelector(".display-customize-users-view");     
    displayCustomizeUsersView.addEventListener('click', ()=> customizeusersview(user));
    
    return header;

}



export {
    createHeader
}

