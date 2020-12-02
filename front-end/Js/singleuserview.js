const displaySingleUserView = function (user) {
    const userPageHeader = document.querySelector(".user-page-header")
    clearChildren(userPageHeader);
    const userNamePageElement = document.createElement("h1");
    userNamePageElement.classList.add("username");
    userNamePageElement.innerText = ${ user.name } + `'s Task List - ` + ${ day } //whatever day is being accessed by the user. default will be Sunday
    const userIcon = document.createElement("img");
    userIcon.classList.add("user-page-icon");
    userPageHeader.appendChild(userNamePageElement);
    userPageHeader.appendChild(userIcon);


    const listOfTasks = document.createElement("div");
    listOfTasks.classList.add("user-task-list");
    userPageHeader.appendChild(listOfTasks);
    user.tasks.day.forEach(task => {
        const taskStickyNote = document.createElement("div")
        taskStickyNote.classList.add("chores-list");
        const checkBox = document.createElement("input");
        checkBox.classList.add("chore-done");
        if(task.done== true){
            checkBox.innerHTML = `<input type="checkbox" checked class="chore-done" id="check-chore">`
        }
        const choreName = document.createElement("label");
        choreName.classList.add("chore-name")
        choreName.innerText = task.title;
        checkBox.setAttribute("id", "check-chore");
        choreName.setAttribute("for", "check-chore");
        const taskInfoList = document.createElement("ul")
        const taskDueDate = document.createElement("li");
        taskDueDate.classList.add("task-due-date");
        taskDueDate.innerText = task.dueBy;
        const taskDuration = document.createElement("li");
        taskDuration.classList.add("task-duration");
        taskDuration.innerText = task.minutesExpectedToComplete;
        listOfTasks.appendChild(taskStickyNote);
        listOfTasks.appendChild(checkBox);
        listOfTasks.appendChild(choreName);
        listOfTasks.appendChild(taskInfoList);
        listOfTasks.appendChild(taskDueDate);
        listOfTasks.appendChild(taskDuration); //not sure if appending them all to the same thing is the right choice//

    });
}

