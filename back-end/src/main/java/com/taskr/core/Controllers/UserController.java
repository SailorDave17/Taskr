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
    public User assignTaskToUser(@PathVariable Long userId, @RequestBody Long taskTemplateId) {
        User user = userStorage.findById(userId);
        TaskTemplate taskTemplate = taskTemplateStorage.findById(taskTemplateId);
        Task newTask = new Task(user, taskTemplate);
        taskStorage.save(newTask);
        return user;
    }

    @PostMapping("/api/user/new")
    public Iterable<User> addNewUser(@RequestBody User user) {
        userStorage.save(user);
        return userStorage.findAll();
    }

    @PatchMapping("/api/user/{id}/update")
    public Iterable<User> updateUserInfo(@PathVariable Long id, @RequestBody User user) {
        User existingUser = userStorage.findById(id);
        if(user.getName() != null){
            existingUser.setName(user.getName());
        }
        if(user.getAvailableTime() != null){
            existingUser.setAvailableTime(user.getAvailableTime());
        }
        if(user.getUserColor() != null){
            existingUser.setUserColor(user.getUserColor());
        }
        userStorage.save(existingUser);
        return userStorage.findAll();
    }

    @GetMapping("/api/user/{id}/delete")
    public Iterable<User> deleteUser(@PathVariable Long id) {
        if (userStorage.findById(id) != null) {
            User userToDelete = userStorage.findById(id);
            userStorage.delete(userToDelete);
        }
        return userStorage.findAll();
    }

    @GetMapping("/api/users")
    public Iterable<User> retrieveAllUsers() {
        return userStorage.findAll();
    }
}
