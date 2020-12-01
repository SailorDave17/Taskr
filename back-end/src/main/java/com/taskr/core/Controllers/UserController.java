package com.taskr.core.Controllers;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import org.springframework.web.bind.annotation.*;

@RestController
public class UserController {

    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;
    private TaskStorage taskStorage;

    public UserController(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, TaskStorage taskStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
    }

    @GetMapping("/api/user/{id}")
    public User retrieveUserById(@PathVariable Long id) {
        return userStorage.findById(id);
    }

    //Not necessary in the final project
    //TODO remove this once auto-assign algorithm exists.
    @PatchMapping("/api/user/{userId}/assign-task")
    public User assignTaskToUser(@PathVariable Long userId, @RequestBody Long taskTemplateId){
        User user = userStorage.findById(userId);
        TaskTemplate taskTemplate = taskTemplateStorage.findById(taskTemplateId);
        Task newTask = new Task(user, taskTemplate);
        taskStorage.save(newTask);
        return user;
    }

    @PostMapping("/api/user/new")
    public Iterable<User> addNewUser(@RequestBody User user) {
//        User newUser = new User(user.getName());
        userStorage.save(user);
        return userStorage.findAll();
    }

    @GetMapping("/api/users")
    public Iterable<User> retrieveAllUsers() {
        return userStorage.findAll();
    }
}
