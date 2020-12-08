package com.taskr.core.storages;

import com.taskr.core.resources.Task;
import com.taskr.core.resources.User;
import org.springframework.stereotype.Service;

@Service
public class UserStorage {
    private UserRepository userRepo;

    public UserStorage(UserRepository userRepo) {
        this.userRepo = userRepo;
    }

    public void save(User user) {
        userRepo.save(user);
    }

    public void deleteById(Long id) {
        userRepo.deleteById(id);
    }

    public void updateUserTimeCommitment(User user) {
        int userTotalAvailableTime = user.getTotalAvailableTime();
        int userTaskLoad = 0;
        for (Task task : user.getTaskList()) {
            userTaskLoad += task.getActualWorkTime();
        }
        user.setCommittedTime(userTaskLoad);
        int userRemainingAvailableTime = userTotalAvailableTime - userTaskLoad;
        System.out.println(user.getName() + " has " + userRemainingAvailableTime + " left.");
        user.setRemainingAvailableTime(userTotalAvailableTime - userTaskLoad);
    }

    public void updateUserTaskCount(User user) {
        int userTaskCount = user.getTaskList().size();
        int userTasksCompleted = 0;
        for (Task task : user.getTaskList()) {
            if (task.isDone()) {
                userTasksCompleted += 1;
            }
        }
        user.setNumberTasksAssigned(userTaskCount);
        user.setNumberTasksComplete(userTasksCompleted);
    }

    public void updateUser(User user) {
        updateUserTimeCommitment(user);
        updateUserTaskCount(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        } else return new User("Dummy user");
    }

}
